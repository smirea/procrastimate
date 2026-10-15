import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { MemoTasks, MemoTasksRequest } from '../../../shared/memo-tasks';
import { formatHlc } from '../../../shared/sync/hlc';
import type { Op, Snapshot, SyncResponse, Task } from '../../../shared/sync/protocol';
import { fieldsOf } from '../../../shared/sync/snapshot';
import { task } from '../../../shared/sync/testing';
import type { TaskEvent } from '../../../shared/values';
import api from '../api';
import type { Env } from '../bindings';
import { memoryAccount } from './account';
import type { AccountStore } from './store';
import { authHeaders, registerDevice, withAuth, type DeviceCredentials } from './test-device';
import { storeFactories } from './test-stores';

const NOW = Date.UTC(2026, 9, 14, 18);
const MEMO = '0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d';
const OTHER_MEMO = '9f1e2d3c-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
const KEY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const KEY_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const KEY_C = 'cccccccc-0000-4000-8000-000000000003';

const STANDUP: TaskEvent = {
	id: 'standup',
	title: 'Standup',
	allDay: false,
	series: false,
	edge: 'before',
	minutes: 15,
	occurrences: [
		{ start: Date.UTC(2026, 9, 19, 16), end: Date.UTC(2026, 9, 19, 16, 15), original: Date.UTC(2026, 9, 19, 16) },
	],
};

const memoTask = (key: string, title: string, fields: Partial<MemoTasksRequest['tasks'][number]> = {}) => ({
	key,
	title,
	notes: '',
	when: null,
	event: null,
	...fields,
});

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

describe.each(storeFactories)('/api/memo-tasks on the %s store', (_name, createStore) => {
	let store: AccountStore;
	let env: Env;
	let memoApp: DeviceCredentials;
	let phone: DeviceCredentials;
	let hlc = 0;

	beforeEach(async () => {
		store = createStore();
		env = withAuth({ ACCOUNT: memoryAccount(store) });
		phone = await registerDevice(env, 'iPhone');
		memoApp = await registerDevice(env, 'NoteTorus');
	});

	const call = (method: string, query: string, body?: unknown, cred: DeviceCredentials | null = memoApp) =>
		api.fetch(
			new Request(`https://procrastimate.test/api/memo-tasks${query}`, {
				method,
				headers: { 'content-type': 'application/json', ...(cred ? authHeaders(cred) : {}) },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
			env,
		);

	async function put(request: MemoTasksRequest): Promise<MemoTasks> {
		const response = await call('PUT', '', request);
		expect(response.status).toBe(200);
		return (await response.json()) as MemoTasks;
	}

	async function list(memoId = MEMO): Promise<MemoTasks> {
		const response = await call('GET', `?memoId=${memoId}`);
		expect(response.status).toBe(200);
		return (await response.json()) as MemoTasks;
	}

	async function phoneSync(ops: Op[] = []): Promise<Snapshot> {
		const response = await api.fetch(
			new Request('https://procrastimate.test/api/sync', {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...authHeaders(phone) },
				body: JSON.stringify({ cursor: 0, ops }),
			}),
			env,
		);
		expect(response.status).toBe(200);
		return ((await response.json()) as Extract<SyncResponse, { snapshot: unknown }>).snapshot;
	}

	const edit = (id: string, fields: Op['fields']): Op =>
		({
			opId: `phone-${++hlc}`,
			hlc: formatHlc({ wall: NOW + hlc, counter: 0, node: phone.deviceId }),
			kind: 'task',
			id,
			fields,
		}) as Op;
	const create = (created: Task): Op =>
		edit(created.id, { deleted: false, ...fieldsOf('task', created) } as Op['fields']);
	const setZone = (timeZone: string) =>
		phoneSync([{ ...edit('settings', {}), kind: 'settings', fields: { timeZone } } as Op]);

	test('adds the tasks to the Inbox, in the order sent, as ordinary tasks every device syncs', async () => {
		const added = await put({
			memoId: MEMO,
			recordedAt: NOW,
			tasks: [
				memoTask(KEY_A, 'Call the plumber', { notes: 'Why: the sink leaks. "it is dripping again"' }),
				memoTask(KEY_B, 'Buy filters'),
			],
		});
		const ids = added.tasks.map(t => t.id);
		expect(added).toEqual({
			tasks: [
				{ key: KEY_A, id: ids[0]!, title: 'Call the plumber', completedAt: null, due: null, event: null },
				{ key: KEY_B, id: ids[1]!, title: 'Buy filters', completedAt: null, due: null, event: null },
			],
		});
		expect((await phoneSync()).tasks).toEqual([
			task(ids[0]!, {
				title: 'Call the plumber',
				notes: 'Why: the sink leaks. "it is dripping again"',
				createdAt: NOW,
				sourceKey: `voicememo:${MEMO}:${KEY_A}`,
			}),
			task(ids[1]!, { title: 'Buy filters', createdAt: NOW + 1, sourceKey: `voicememo:${MEMO}:${KEY_B}` }),
		]);
		expect(store.hasOp(`voicememo:${MEMO}:${KEY_A}`)).toBe(true);
	});

	test('a retry changes nothing and answers the same', async () => {
		const request = { memoId: MEMO, recordedAt: NOW, tasks: [memoTask(KEY_A, 'Call the plumber')] };
		const first = await put(request);
		const head = store.lastSeq();
		expect(await put(request)).toEqual(first);
		expect(store.lastSeq()).toBe(head);
	});

	test('a task deleted in ProcrastiMate stays deleted when the memo app sends it again', async () => {
		const [sent] = (await put({ memoId: MEMO, recordedAt: NOW, tasks: [memoTask(KEY_A, 'Call the plumber')] })).tasks;
		await phoneSync([edit(sent!.id, { deleted: true })]);
		const head = store.lastSeq();
		const again = await put({
			memoId: MEMO,
			recordedAt: NOW,
			tasks: [memoTask(KEY_A, 'Call the plumber'), memoTask(KEY_B, 'Buy filters')],
		});
		expect(again.tasks.map(t => [t.key, t.title])).toEqual([[KEY_B, 'Buy filters']]);
		expect(store.lastSeq()).toBe(head + 1);
		expect((await phoneSync()).tasks.map(t => t.title)).toEqual(['Buy filters']);
	});

	test('reads the spoken time as of the recording in the account zone, keeping only the date and repeat', async () => {
		await setZone('America/Los_Angeles');
		// 05:00 UTC on Oct 15 is still 22:00 on Oct 14 in Los Angeles.
		const recordedAt = Date.UTC(2026, 9, 15, 5);
		const added = await put({
			memoId: MEMO,
			recordedAt,
			tasks: [
				memoTask(KEY_A, 'Call the plumber', { when: 'tomorrow at 3pm' }),
				memoTask(KEY_B, 'Water plants', { when: 'every monday p1 remind me 1 hour before' }),
				memoTask(KEY_C, 'Think about it', { when: 'when the mood strikes' }),
			],
		});
		expect(added.tasks.map(t => t.due)).toEqual([
			{ date: '2026-10-15', time: '15:00' },
			{ date: '2026-10-19', time: null },
			null,
		]);
		expect((await phoneSync()).tasks.map(t => [t.title, t.recurrence, t.priority, t.reminders])).toEqual([
			['Call the plumber', null, 4, []],
			['Water plants', { interval: 1, unit: 'week' }, 4, []],
			['Think about it', null, 4, []],
		]);
	});

	test('passes the event through, and an event replaces the spoken time', async () => {
		const added = await put({
			memoId: MEMO,
			recordedAt: NOW,
			tasks: [memoTask(KEY_A, 'Prep the demo', { when: 'tomorrow', event: STANDUP })],
		});
		expect(added.tasks.map(t => [t.due, t.event])).toEqual([[null, STANDUP]]);
		expect((await phoneSync()).tasks.map(t => [t.due, t.recurrence, t.event])).toEqual([[null, null, STANDUP]]);
	});

	test('lists only that memo’s live tasks in the order sent, completed ones included', async () => {
		const sent = await put({
			memoId: MEMO,
			recordedAt: NOW,
			tasks: [memoTask(KEY_A, 'First'), memoTask(KEY_B, 'Second'), memoTask(KEY_C, 'Third')],
		});
		await put({ memoId: OTHER_MEMO, recordedAt: NOW, tasks: [memoTask(KEY_A, 'Elsewhere')] });
		const [first, second] = sent.tasks.map(t => t.id);
		await phoneSync([edit(first!, { completedAt: NOW + 5 }), edit(second!, { deleted: true })]);
		expect((await list()).tasks.map(t => [t.key, t.title, t.completedAt])).toEqual([
			[KEY_A, 'First', NOW + 5],
			[KEY_C, 'Third', null],
		]);
		expect((await list(OTHER_MEMO)).tasks.map(t => t.title)).toEqual(['Elsewhere']);
	});

	test('DELETE removes the memo’s tasks and their subtasks, and leaves other tasks', async () => {
		const sent = await put({ memoId: MEMO, recordedAt: NOW, tasks: [memoTask(KEY_A, 'Plan trip')] });
		await put({ memoId: OTHER_MEMO, recordedAt: NOW, tasks: [memoTask(KEY_A, 'Elsewhere')] });
		const parentId = sent.tasks[0]!.id;
		await phoneSync([
			create(task('sub', { parentId, title: 'Book flights', createdAt: NOW + 10 })),
			create(task('mine', { title: 'Typed by hand', createdAt: NOW + 11 })),
		]);

		const response = await call('DELETE', `?memoId=${MEMO}`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect((await list()).tasks).toEqual([]);
		expect((await phoneSync()).tasks.map(t => t.title)).toEqual(['Elsewhere', 'Typed by hand']);
	});

	test('rejects a request without a device, and a memo id that is not a lowercase UUID', async () => {
		const request = { memoId: MEMO, recordedAt: NOW, tasks: [memoTask(KEY_A, 'Call the plumber')] };
		expect((await call('PUT', '', request, null)).status).toBe(401);
		expect((await call('PUT', '', request, { ...memoApp, deviceId: '' })).status).toBe(401);
		expect((await call('GET', `?memoId=${MEMO}`, undefined, null)).status).toBe(401);
		expect((await call('DELETE', `?memoId=${MEMO}`, undefined, null)).status).toBe(401);
		expect((await call('GET', `?memoId=${MEMO.toUpperCase()}`)).status).toBe(400);
		expect(store.lastSeq()).toBe(0);
	});
});
