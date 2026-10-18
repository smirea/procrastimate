import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { MemoTasks } from '../../shared/memo-tasks';
import { inArray } from 'drizzle-orm';
import { tasks } from '../../shared/db/schema';
import { json, signUp, taskRow, testApp, upload, type Session, type TestApp } from './test-app';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});
afterAll(() => app.close());

const memoId = crypto.randomUUID();
const keys = [crypto.randomUUID(), crypto.randomUUID()];
const request = (tasks: { key: string; title: string }[]) => ({
	memoId,
	recordedAt: Date.UTC(2026, 9, 14, 9),
	tasks: tasks.map(task => ({ ...task, notes: '', when: null, event: null })),
});

const put = (body: unknown) =>
	json<MemoTasks>(app.fetch('/api/memo-tasks', { method: 'PUT', headers: owner.headers, body: JSON.stringify(body) }));
const list = () => json<MemoTasks>(app.fetch(`/api/memo-tasks?memoId=${memoId}`, { headers: owner.headers }));

describe('/api/memo-tasks', () => {
	test('adds the memo’s tasks once, lists them, and ignores a key it has seen', async () => {
		const first = await put(request([{ key: keys[0]!, title: 'Buy bread' }]));
		expect(first.tasks.map(task => task.title)).toEqual(['Buy bread']);
		const second = await put(
			request([
				{ key: keys[0]!, title: 'Buy bread again' },
				{ key: keys[1]!, title: 'Call Ann' },
			]),
		);
		expect(second.tasks.map(task => task.title).toSorted()).toEqual(['Buy bread', 'Call Ann']);
		expect((await list()).tasks).toHaveLength(2);
	});

	test('two overlapping sends of one memo add each of its tasks once', async () => {
		const overlapping = {
			...request([{ key: crypto.randomUUID(), title: 'Fix the gate' }]),
			memoId: crypto.randomUUID(),
		};
		const [a, b] = await Promise.all([put(overlapping), put(overlapping)]);
		expect(a.tasks.map(task => task.id)).toEqual(b.tasks.map(task => task.id));
		const listed = await json<MemoTasks>(
			app.fetch(`/api/memo-tasks?memoId=${overlapping.memoId}`, { headers: owner.headers }),
		);
		expect(listed.tasks.map(task => task.title)).toEqual(['Fix the gate']);
	});

	test('a deleted memo task never comes back, even when the memo is sent again', async () => {
		const { tasks } = await list();
		expect(
			(await app.fetch(`/api/memo-tasks?memoId=${memoId}`, { method: 'DELETE', headers: owner.headers })).status,
		).toBe(200);
		expect((await list()).tasks).toEqual([]);
		expect((await put(request([{ key: keys[0]!, title: 'Buy bread' }]))).tasks).toEqual([]);
		expect(tasks).toHaveLength(2);
	});

	test('a task the user deleted from the app stays gone too', async () => {
		const memo = { ...request([{ key: crypto.randomUUID(), title: 'Water plants' }]), memoId: crypto.randomUUID() };
		const added = await put(memo);
		expect(await upload(app, owner, [{ op: 'delete', table: 'tasks', id: added.tasks[0]!.id }])).toEqual([]);
		expect((await put(memo)).tasks).toEqual([]);
	});

	test('deleting a memo takes the subtasks under its tasks, and nothing else', async () => {
		const memo = crypto.randomUUID();
		const added = await put({ ...request([{ key: crypto.randomUUID(), title: 'Move house' }]), memoId: memo });
		const parent = added.tasks[0]!.id;
		const subtask = crypto.randomUUID();
		const other = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'tasks',
				id: subtask,
				values: taskRow(subtask, owner.person.id, 'Pack boxes', { parentId: parent }),
			},
			{ op: 'put', table: 'tasks', id: other, values: taskRow(other, owner.person.id, 'Unrelated') },
		]);
		await app.fetch(`/api/memo-tasks?memoId=${memo}`, { method: 'DELETE', headers: owner.headers });
		const left = await app.db
			.select({ id: tasks.id })
			.from(tasks)
			.where(inArray(tasks.id, [parent, subtask, other]));
		expect(left.map(row => row.id)).toEqual([other]);
	});
});
