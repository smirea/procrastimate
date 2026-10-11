import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import type { Client, InStatement, ResultSet } from '@libsql/client/web';
import { queuedRambleLedger } from './ramble-ledger';
import { serialQueue } from './serial';
import { accountSession, writeRambleUsage } from './turso';

/** A libSQL client over `bun:sqlite`, so a session can round-trip without Turso. */
function sqliteClient(hooks?: { beforeBatch?: () => Promise<void> }): Client {
	const db = new Database(':memory:', { strict: true });
	const run = (statement: InStatement) => {
		const sql = typeof statement === 'string' ? statement : statement.sql;
		const args = typeof statement === 'string' ? [] : (statement.args ?? []);
		const query = db.query(sql);
		const rows = sql.trimStart().toUpperCase().startsWith('SELECT')
			? query.all(...(args as SQLQueryBindings[]))
			: (query.run(...(args as SQLQueryBindings[])), []);
		return { rows } as unknown as ResultSet;
	};
	const client: Pick<Client, 'execute' | 'executeMultiple' | 'batch'> = {
		execute: statement => Promise.resolve(run(statement)),
		executeMultiple: async sql => {
			db.exec(sql);
		},
		batch: async statements => {
			await hooks?.beforeBatch?.();
			return statements.map(statement => run(statement as InStatement));
		},
	};
	return client as Client;
}

describe('a Turso session', () => {
	test('loads what the last flush wrote, including a wiped epoch', async () => {
		const client = sqliteClient();
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

	test('a flush leaves another user alone, and a table without user_id is replaced', async () => {
		const client = sqliteClient();
		await client.executeMultiple(
			'CREATE TABLE entities (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, clocks TEXT NOT NULL, PRIMARY KEY (kind, id))',
		);
		await client.execute({
			sql: 'INSERT INTO entities (kind, id, data, clocks) VALUES (?, ?, ?, ?)',
			args: ['task', 'old', '{}', '{}'],
		});
		const mine = await accountSession(client, 'user-1');
		mine.store.putEntity({ kind: 'task', id: 't1', data: { title: 'Mine' }, clocks: {} });
		await mine.flush();
		const other = await accountSession(client, 'user-2');
		expect(other.store.entities()).toEqual([]);
		other.store.putEntity({ kind: 'task', id: 't2', data: { title: 'Other' }, clocks: {} });
		await other.flush();
		const again = await accountSession(client, 'user-1');
		expect(again.store.entities()).toEqual([{ kind: 'task', id: 't1', data: { title: 'Mine' }, clocks: {} }]);
	});

	test('queued flushes keep both writes when the first flush yields', async () => {
		let release = () => {};
		let batches = 0;
		const client = sqliteClient({
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
			session.store.putEntity({ kind: 'task', id: 'a', data: { title: 'A' }, clocks: {} });
			await session.flush();
		});
		for (let i = 0; i < 50 && batches < 1; i++) await Bun.sleep(5);
		expect(batches).toBe(1);
		const second = run(async () => {
			const session = await accountSession(client, 'user-1');
			session.store.putEntity({ kind: 'task', id: 'b', data: { title: 'B' }, clocks: {} });
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
		const client = sqliteClient();
		const run = serialQueue();
		const attach = () => queuedRambleLedger(run, rows => writeRambleUsage(client, 'user-1', rows));
		let ledger = attach();
		const first = await accountSession(client, 'user-1', ledger);
		first.store.putEntity({ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: {} });
		await first.flush();
		first.store.addRambleSeconds('2026-10-14', 12.5);
		await ledger.settled();

		ledger = attach();
		const second = await accountSession(client, 'user-1', ledger);
		expect(second.store.rambleSeconds('2026-10-14')).toBe(12.5);
		expect(second.store.entities()).toEqual([{ kind: 'task', id: 't1', data: { title: 'Buy milk' }, clocks: {} }]);
		const other = await accountSession(client, 'user-2');
		expect(other.store.rambleSeconds('2026-10-14')).toBe(0);
	});

	test('a flush that snapshotted ramble before new seconds does not drop them', async () => {
		let release = () => {};
		let batches = 0;
		const client = sqliteClient({
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
