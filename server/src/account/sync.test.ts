import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { DeviceCredentials } from '../../../shared/auth';
import { todoistBackupFiles } from '../../../shared/fixtures/todoist-backup.mts';
import { applyResponse, startSync, type ClientSync } from '../../../shared/sync/apply';
import { formatHlc } from '../../../shared/sync/hlc';
import type { Op, Snapshot, SyncResponse } from '../../../shared/sync/protocol';
import { counter, label, project, snapshotOf, task } from '../../../shared/sync/testing';
import { mergeBackup, readTodoistBackup } from '../../../shared/todoist';
import api from '../api';
import type { Env } from '../bindings';
import { memoryAccount } from './account';
import type { AccountStore } from './store';
import { SYNC_PAGE_SIZE } from './sync';
import { storeFactories } from './test-stores';

const NOW = Date.UTC(2026, 9, 10, 12);
const SETUP_CODE = 'correct-horse-battery-staple';

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

const op = (opId: string, hlc: string, fields: Op['fields'], id = 't1'): Op =>
	({ opId, hlc, kind: 'task', id, fields }) as Op;

describe.each(storeFactories)('POST /api/sync on the %s store', (_name, createStore) => {
	let store: AccountStore;
	let env: Env;

	beforeEach(() => {
		store = createStore();
		env = { ACCOUNT: memoryAccount(SETUP_CODE, store) };
	});

	const post = (body: unknown, token?: string) =>
		api.fetch(
			new Request('https://procrastimate.test/api/sync', {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: JSON.stringify(body),
			}),
			env,
		);

	async function setup(name = 'Mac') {
		const response = await api.fetch(
			new Request('https://procrastimate.test/api/auth/setup', {
				method: 'POST',
				body: JSON.stringify({ code: SETUP_CODE, name }),
			}),
			env,
		);
		return (await response.json()) as DeviceCredentials;
	}

	async function sync(token: string, cursor: number, ops: readonly Op[]) {
		const response = await post({ cursor, ops }, token);
		expect(response.status).toBe(200);
		return (await response.json()) as SyncResponse;
	}

	/** A paired device that uploads its whole snapshot on its first sync, as the web and iOS clients do. */
	async function device(name: string, snapshot: Snapshot) {
		const { deviceId, token } = await setup(name);
		const client: { snapshot: Snapshot; sync: ClientSync } = {
			snapshot,
			sync: startSync(snapshot, deviceId, Date.now(), counter(`${name}-op-`)),
		};
		return {
			client,
			async pull() {
				const response = await sync(token, client.sync.cursor, client.sync.outbox);
				({ snapshot: client.snapshot, sync: client.sync } = applyResponse(client.snapshot, client.sync, response));
				return response;
			},
		};
	}

	const serverSnapshot = async (): Promise<Snapshot | null> => {
		const response = await sync((await setup('Observer')).token, 0, []);
		return 'snapshot' in response ? (response.snapshot as Snapshot) : null;
	};

	test('rejects a missing, unknown, or revoked token, and an invalid body', async () => {
		expect((await post({ cursor: 0, ops: [] })).status).toBe(401);
		expect((await post({ cursor: 0, ops: [] }, 'made-up')).status).toBe(401);

		const { deviceId, token } = await setup();
		expect((await post({ cursor: -1, ops: [] }, token)).status).toBe(400);
		expect((await post({ cursor: 0, ops: [op('o1', 'nope', {})] }, token)).status).toBe(400);

		store.revokeDevice(deviceId, NOW);
		expect((await post({ cursor: 0, ops: [op('o1', `${NOW}:0:x`, { title: 'A' })] }, token)).status).toBe(401);
		expect(store.lastSeq()).toBe(0);
	});

	test('a retried push applies once and answers the same', async () => {
		const { token } = await setup();
		const created = task('t1', { createdAt: NOW, title: 'A' });
		const ops = startSync(snapshotOf({ tasks: [created] }), 'mac', NOW, counter('op-')).outbox;
		const first = await sync(token, 0, ops);
		const head = store.lastSeq();
		const retry = await sync(token, 0, ops);
		expect(retry).toEqual(first);
		expect(store.lastSeq()).toBe(head);
		expect(await sync(token, head, ops)).toMatchObject({ acked: first.acked, changes: [], cursor: head });
	});

	test('logs every op, even one that won nothing, so a retry with a clamped clock cannot win again', async () => {
		const mac = await setup('mac');
		const phone = await setup('phone');
		await sync(mac.token, 0, startSync(snapshotOf({ tasks: [task('t1')] }), 'mac', NOW, counter('op-')).outbox);
		const head = store.lastSeq();
		const future = op('future', formatHlc({ wall: NOW + 3_600_000, counter: 0, node: 'mac' }), { title: 'Ahead' });
		const stale = op('stale', formatHlc({ wall: 1, counter: 0, node: 'mac' }), { notes: 'Stale' });

		const pushed = await sync(mac.token, head, [future, stale]);
		expect('changes' in pushed && pushed.changes.map(change => [change.opId, change.fields])).toEqual([
			['future', { title: 'Ahead' }],
			['stale', {}],
		]);

		setSystemTime(NOW + 5);
		const later = op('later', formatHlc({ wall: NOW + 5, counter: 0, node: 'phone' }), { title: 'Later' });
		await sync(phone.token, store.lastSeq(), [later]);
		const before = store.lastSeq();
		setSystemTime(NOW + 10);
		const retry = await sync(mac.token, before, [future, stale]);
		expect(retry).toMatchObject({ acked: ['future', 'stale'], changes: [], cursor: before });
		expect((await serverSnapshot())?.tasks.map(t => [t.title, t.notes])).toEqual([['Later', '']]);
	});

	test('pages changes after the cursor', async () => {
		const { token } = await setup();
		await sync(token, 0, [op('seed', `${NOW}:0:mac`, { ...task('seed'), deleted: false }, 'seed')]);
		const head = store.lastSeq();
		const tasks = Array.from({ length: SYNC_PAGE_SIZE + 5 }, (_, i) => task(`t${i}`, { createdAt: NOW + i }));
		const ops = startSync(snapshotOf({ tasks }), 'mac', NOW, counter('op-')).outbox;
		const first = await sync(token, head, ops);
		if (!('changes' in first)) throw new Error('expected changes');
		expect(first.changes.map(change => change.seq)).toEqual(tasks.slice(0, SYNC_PAGE_SIZE).map((_, i) => head + i + 1));
		expect(first.cursor).toBe(head + SYNC_PAGE_SIZE);
		expect(first.acked).toEqual(ops.slice(0, SYNC_PAGE_SIZE).map(o => o.opId));

		const unacked = ops.slice(SYNC_PAGE_SIZE);
		const end = store.lastSeq();
		const rest = await sync(token, first.cursor, unacked);
		expect('changes' in rest && rest.changes.map(change => change.id)).toEqual(
			tasks.slice(SYNC_PAGE_SIZE).map(t => t.id),
		);
		expect(rest.acked).toEqual(unacked.map(o => o.opId));
		expect(rest.cursor).toBe(end);
		expect(store.lastSeq()).toBe(end);
		expect(await sync(token, rest.cursor, [])).toMatchObject({ changes: [], cursor: rest.cursor });
	});

	test('cursor 0, or one past the end of the log, gets the snapshot and the head of the log', async () => {
		const mac = await device('mac', snapshotOf({ tasks: [task('t1', { createdAt: NOW })] }));
		await mac.pull();
		const phone = await setup('phone');

		const fresh = await sync(phone.token, 0, []);
		expect(fresh).toMatchObject({ snapshot: mac.client.snapshot, cursor: store.lastSeq() });
		expect(fresh.hlc).toMatch(/:server$/);

		const reset = await sync(phone.token, store.lastSeq() + 50, []);
		expect(reset).toMatchObject({ snapshot: mac.client.snapshot, cursor: store.lastSeq() });

		const edit = op('edit', `${NOW + 1}:0:phone`, { title: 'Edited' });
		const refilled = await sync(phone.token, store.lastSeq() + 1, [edit]);
		expect(refilled).toMatchObject({ acked: ['edit'], cursor: store.lastSeq() });
		expect('snapshot' in refilled && refilled.snapshot.tasks.map(t => t.title)).toEqual(['Edited']);
	});

	test('two devices that imported the same Todoist backup and typed the same names converge on one copy', async () => {
		const backup = readTodoistBackup(todoistBackupFiles, new Date(NOW));
		const local = (prefix: string, createdAt: number) => {
			const errands = label(`${prefix}-errands`, { name: prefix === 'a' ? 'Errands' : 'errands', createdAt });
			const home = project(`${prefix}-home`, { name: prefix === 'a' ? 'Home' : 'HOME', createdAt });
			const typed = task(`${prefix}-typed`, {
				title: 'Buy milk',
				projectId: home.id,
				labelIds: [errands.id],
				createdAt,
			});
			const base = { tasks: [typed], projects: [home], labels: [errands] };
			const { state } = mergeBackup(base, backup, { newId: counter(`${prefix}-`), now: createdAt });
			return snapshotOf(state);
		};
		const mac = await device('mac', local('a', 1000));
		const phone = await device('phone', local('b', 2000));

		await mac.pull();
		await phone.pull();
		await mac.pull();

		const server = await serverSnapshot();
		expect(mac.client.snapshot).toEqual(server!);
		expect(phone.client.snapshot).toEqual(server!);
		expect(phone.client.sync.outbox).toEqual([]);

		const imported = server!.tasks.filter(t => t.sourceKey);
		expect(imported).toHaveLength(backup.tasks.length);
		expect(imported.every(t => t.id.startsWith('a-'))).toBe(true);
		expect(server!.projects.filter(p => p.sourceKey).every(p => p.id.startsWith('a-'))).toBe(true);
		expect(server!.projects.filter(p => p.name.toLowerCase() === 'home').map(p => p.id)).toEqual(['a-home']);
		expect(server!.labels.filter(l => l.name.toLowerCase() === 'errands').map(l => l.id)).toEqual(['a-errands']);
		expect(new Set(server!.labels.map(l => l.name.toLowerCase())).size).toBe(server!.labels.length);

		const typed = server!.tasks.filter(t => t.title === 'Buy milk');
		expect(typed.map(t => [t.id, t.projectId, t.labelIds])).toEqual([
			['a-typed', 'a-home', ['a-errands']],
			['b-typed', 'a-home', ['a-errands']],
		]);
		const ids = new Set(server!.tasks.map(t => t.id));
		expect(server!.tasks.every(t => t.parentId === null || ids.has(t.parentId))).toBe(true);
	});
});
