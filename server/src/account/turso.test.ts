import { describe, expect, test } from 'bun:test';
import { localClient, localTurso } from '../db/test-turso';
import { openDatabase } from '../db/turso';
import { queuedRambleLedger } from './ramble-ledger';
import { serialQueue } from './serial';
import { accountSession, writeRambleUsage } from './turso';

describe('a Turso session', () => {
	test('loads what the last flush wrote, including a wiped epoch', async () => {
		const client = await localTurso();
		const first = await accountSession(client, 'user-1');
		first.store.addDevice({
			id: 'mac',
			name: 'Mac',
			tokenHash: 'hash',
			createdAt: 1,
			lastSeenAt: 1,
			revokedAt: null,
		});
		first.store.putEntity({ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: { title: '1:0:mac' } });
		first.store.appendLog({ opId: 'op-1', kind: 'task', id: 't1', fields: { title: 'Buy milk' } });
		first.store.setEpoch(2);
		await first.flush();

		const second = await accountSession(client, 'user-1');
		expect(second.store.liveDevices().map(device => device.id)).toEqual(['mac']);
		expect(second.store.entities()).toEqual([
			{ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: { title: '1:0:mac' } },
		]);
		expect(second.store.logAfter(0, 10)).toEqual([
			{ seq: 1, opId: 'op-1', kind: 'task', id: 't1', fields: { title: 'Buy milk' } },
		]);
		expect(second.store.epoch()).toBe(2);

		second.store.clearTaskData();
		second.store.setEpoch(3);
		await second.flush();

		const third = await accountSession(client, 'user-1');
		expect(third.store.entities()).toEqual([]);
		expect(third.store.lastSeq()).toBe(0);
		expect(third.store.liveDevices()).toHaveLength(1);
		expect(third.store.epoch()).toBe(3);
	});

	test('rows from the old entities table move into the typed tables', async () => {
		const legacy = localClient();
		await legacy.execute(
			'CREATE TABLE entities (user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, clocks TEXT NOT NULL, PRIMARY KEY (user_id, kind, id))',
		);
		const task = {
			parentId: null,
			order: 1.5,
			title: 'Call mom',
			notes: '',
			projectId: 'p1',
			labelIds: ['l1'],
			due: { date: '2026-10-14', time: '09:30' },
			recurrence: { interval: 1, unit: 'week', days: [1, 3] },
			priority: 2,
			reminders: [{ kind: 'before', minutes: 30 }],
			createdAt: 10,
			completedAt: null,
			sourceKey: null,
			deleted: false,
		};
		const clocks = Object.fromEntries(Object.keys(task).map(key => [key, '1:0:mac']));
		const rows: [string, string, unknown, Record<string, string>][] = [
			['task', 't1', task, clocks],
			['task', 'gone', { deleted: true }, { deleted: '2:0:mac' }],
			[
				'project',
				'p1',
				{ name: 'Home', createdAt: 1, sourceKey: 'todoist:project:1', deleted: false },
				{ name: '1:0:mac', createdAt: '1:0:mac', sourceKey: '1:0:mac', deleted: '1:0:mac' },
			],
			[
				'label',
				'l1',
				{ name: 'Errand', createdAt: 2, deleted: false },
				{ name: '1:0:mac', createdAt: '1:0:mac', deleted: '1:0:mac' },
			],
			['settings', 'settings', { timeZone: 'Europe/Berlin' }, { timeZone: '1:0:mac' }],
		];
		for (const [kind, id, data, rowClocks] of rows) {
			await legacy.execute({
				sql: 'INSERT INTO entities VALUES (?, ?, ?, ?, ?)',
				args: ['user-1', kind, id, JSON.stringify(data), JSON.stringify(rowClocks)],
			});
		}
		const session = await accountSession(await openDatabase(legacy), 'user-1');
		const byId = new Map(session.store.entities().map(entity => [entity.id, entity]));
		expect(byId.get('t1')).toEqual({ kind: 'task', id: 't1', data: task, clocks });
		expect(byId.get('gone')).toEqual({
			kind: 'task',
			id: 'gone',
			data: { deleted: true },
			clocks: { deleted: '2:0:mac' },
		});
		expect(byId.get('p1')?.data).toEqual({
			name: 'Home',
			createdAt: 1,
			sourceKey: 'todoist:project:1',
			deleted: false,
		});
		expect(byId.get('l1')?.data).toEqual({ name: 'Errand', createdAt: 2, deleted: false });
		expect(byId.get('settings')?.data).toEqual({ timeZone: 'Europe/Berlin' });
	});

	test('a flush leaves another user alone, and a table without user_id is replaced', async () => {
		const legacy = localClient();
		await legacy.executeMultiple(
			'CREATE TABLE entities (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, clocks TEXT NOT NULL, PRIMARY KEY (kind, id))',
		);
		await legacy.execute({
			sql: 'INSERT INTO entities (kind, id, data, clocks) VALUES (?, ?, ?, ?)',
			args: ['task', 'old', '{}', '{}'],
		});
		const client = await openDatabase(legacy);
		const mine = await accountSession(client, 'user-1');
		mine.store.putEntity({ kind: 'task', id: 't1', data: { title: 'Mine' }, clocks: { title: '1:0:device' } });
		await mine.flush();
		const other = await accountSession(client, 'user-2');
		expect(other.store.entities()).toEqual([]);
		other.store.putEntity({ kind: 'task', id: 't2', data: { title: 'Other' }, clocks: { title: '1:0:device' } });
		await other.flush();
		const again = await accountSession(client, 'user-1');
		expect(again.store.entities()).toEqual([
			{ kind: 'task', id: 't1', data: { title: 'Mine' }, clocks: { title: '1:0:device' } },
		]);
	});

	test('queued flushes keep both writes when the first flush yields', async () => {
		let release = () => {};
		let batches = 0;
		const client = await localTurso({
			beforeBatch: () => {
				batches += 1;
				if (batches > 1) return Promise.resolve();
				return new Promise<void>(resolve => {
					release = resolve;
				});
			},
		});
		const run = serialQueue();
		const first = run(async () => {
			const session = await accountSession(client, 'user-1');
			session.store.putEntity({ kind: 'task', id: 'a', data: { title: 'A' }, clocks: { title: '1:0:device' } });
			await session.flush();
		});
		for (let i = 0; i < 50 && batches < 1; i++) await Bun.sleep(5);
		expect(batches).toBe(1);
		const second = run(async () => {
			const session = await accountSession(client, 'user-1');
			session.store.putEntity({ kind: 'task', id: 'b', data: { title: 'B' }, clocks: { title: '1:0:device' } });
			await session.flush();
		});
		release();
		await Promise.all([first, second]);
		const third = await accountSession(client, 'user-1');
		expect(
			third.store
				.entities()
				.map(entity => entity.id)
				.sort(),
		).toEqual(['a', 'b']);
	});

	test('ramble seconds recorded after the flush are loaded by the next session', async () => {
		const client = await localTurso();
		const run = serialQueue();
		const attach = () => queuedRambleLedger(run, rows => writeRambleUsage(client, 'user-1', rows));
		let ledger = attach();
		const first = await accountSession(client, 'user-1', ledger);
		first.store.putEntity({ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: { title: '1:0:device' } });
		await first.flush();
		first.store.addRambleSeconds('2026-10-14', 12.5);
		await ledger.settled();

		ledger = attach();
		const second = await accountSession(client, 'user-1', ledger);
		expect(second.store.rambleSeconds('2026-10-14')).toBe(12.5);
		expect(second.store.entities()).toEqual([
			{ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: { title: '1:0:device' } },
		]);
		const other = await accountSession(client, 'user-2');
		expect(other.store.rambleSeconds('2026-10-14')).toBe(0);
	});

	test('a flush that snapshotted ramble before new seconds does not drop them', async () => {
		let release = () => {};
		let batches = 0;
		const client = await localTurso({
			beforeBatch: () => {
				batches += 1;
				if (batches > 1) return Promise.resolve();
				return new Promise<void>(resolve => {
					release = resolve;
				});
			},
		});
		const run = serialQueue();
		const ledger = queuedRambleLedger(run, rows => writeRambleUsage(client, 'user-1', rows));
		const request = run(async () => {
			const session = await accountSession(client, 'user-1', ledger);
			await session.flush();
		});
		for (let i = 0; i < 50 && batches < 1; i++) await Bun.sleep(5);
		expect(batches).toBe(1);
		const side = await accountSession(client, 'user-1', ledger);
		side.store.addRambleSeconds('2026-10-14', 9);
		release();
		await request;
		await ledger.settled();
		const fresh = queuedRambleLedger(serialQueue(), rows => writeRambleUsage(client, 'user-1', rows));
		const again = await accountSession(client, 'user-1', fresh);
		expect(again.store.rambleSeconds('2026-10-14')).toBe(9);
	});
});
