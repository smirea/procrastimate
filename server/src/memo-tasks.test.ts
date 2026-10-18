import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { MemoTasks } from '../../shared/memo-tasks';
import { json, signUp, testApp, upload, type Session, type TestApp } from './test-app';

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
		const other = crypto.randomUUID();
		const added = await put({ ...request([{ key: other, title: 'Water plants' }]), memoId: crypto.randomUUID() });
		expect(await upload(app, owner, [{ op: 'delete', table: 'tasks', id: added.tasks[0]!.id }])).toEqual([]);
		const again = await put({ ...request([{ key: other, title: 'Water plants' }]), memoId: crypto.randomUUID() });
		expect(again.tasks.map(task => task.title)).toEqual(['Water plants']);
	});
});
