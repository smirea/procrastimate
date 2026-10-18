import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Person, ShareView } from '../../shared/sharing';
import { deliverDue } from './push';
import { json, signUp, taskRow, testApp, tokenHeaders, upload, type Session, type TestApp } from './test-app';

/**
 * What the routes that read a space cost in SQL statements, counted like `write-cost.test.ts`. Each statement is named
 * by its verb and the table it reads or writes, so a whole-space load creeping back in fails here by name.
 */

let app: TestApp;
let owner: Session;
let guest: Session;
let ai: Record<string, string>;
let aiId: string;
let space: string;
let taskId: string;
let imageId: string;
let linkId: string;
const memoId = crypto.randomUUID();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const subscription = { endpoint: 'https://push.example/read-cost', keys: { p256dh: 'p', auth: 'a' } };

const post = (session: Session, path: string, body: unknown) =>
	json(app.fetch(path, { method: 'POST', headers: session.headers, body: JSON.stringify(body) }));

beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
	guest = await signUp(app, 'Guest');
	space = `space=${owner.person.id}`;
	taskId = crypto.randomUUID();
	imageId = crypto.randomUUID();
	const commentId = crypto.randomUUID();
	await Promise.all([
		app.fetch('/api/me', { headers: owner.headers }),
		app.fetch('/api/me', { headers: guest.headers }),
	]);
	await app.fetch(`/api/images?id=${imageId}&size=full`, {
		method: 'PUT',
		headers: { ...owner.headers, 'content-type': 'image/jpeg' },
		body: new Blob([JPEG]),
	});
	await upload(app, owner, [
		{
			op: 'put',
			table: 'tasks',
			id: taskId,
			values: taskRow(taskId, owner.person.id, 'Costed', {
				images: JSON.stringify([{ id: imageId, width: 4, height: 3 }]),
			}),
		},
		{
			op: 'put',
			table: 'comments',
			id: commentId,
			values: { id: commentId, user_id: owner.person.id, task_id: taskId, body: 'Hi', created_at: 1, edited_at: null },
		},
	]);
	await post(owner, '/api/shares', {
		target: { kind: 'task', id: taskId },
		audience: { kind: 'user', userId: guest.person.id, role: 'edit' },
	});
	aiId = (await post(owner, '/api/ai', { name: 'Bot' }).then(body => body as Person)).id;
	const { token } = (await post(owner, '/api/ai-tokens', { aiUserId: aiId, name: 'cost' })) as { token: string };
	ai = tokenHeaders(token);
	linkId = ((await post(owner, '/api/links', { target: { kind: 'task', id: taskId } })) as ShareView).id;
});
afterAll(() => app.close());

/** `select tasks`, `insert log`, `lock`: the verb and the first table each statement names, then any lateral read's. */
function named(statement: string): string {
	if (statement.startsWith('SELECT pg_advisory_xact_lock')) return 'lock';
	if (/^(savepoint|release)/i.test(statement)) return statement.split(' ')[0]!.toLowerCase();
	const verb = /^\(*(select|insert|update|delete)\b/.exec(statement)?.[1];
	const table = /\b(?:from|into|update)\s+"(\w+)"/.exec(statement)?.[1];
	const lateral = [...statement.matchAll(/join lateral \(select .*? from "(\w+)"/g)].map(match => match[1]);
	return [`${verb} ${table}`, ...lateral].join(' + ');
}

async function statementsOf(path: string, init: RequestInit = {}): Promise<string[]> {
	app.statements.length = 0;
	const response = await app.fetch(path, init);
	expect(response.status).toBe(200);
	await response.arrayBuffer();
	return app.statements.map(named);
}

// The token and its AI user come back in one join.
const asBot = ['select api_tokens'];
const tree = ['select tasks', 'select projects', 'select sections', 'select labels'];

describe('statements per read', () => {
	test('an image: the owner reads the row, a guest its grants and the row checked against what it sees', async () => {
		const path = `/api/images?id=${imageId}&size=full`;
		expect(await statementsOf(path, { headers: owner.headers })).toEqual(['select images']);
		expect(await statementsOf(`${path}&${space}`, { headers: guest.headers })).toEqual([
			'select shares',
			'select images',
		]);
		expect(await statementsOf(path, { headers: ai })).toEqual([...asBot, 'select shares', 'select images']);
	});

	test('the share list is the shares and their grantees’ names', async () => {
		expect(await statementsOf('/api/shares', { headers: owner.headers })).toEqual(['select shares', 'select user']);
	});

	test('a token checks the AI account and its share in one select', async () => {
		const body = JSON.stringify({ aiUserId: aiId, name: 'again' });
		expect(await statementsOf('/api/ai-tokens', { method: 'POST', headers: owner.headers, body })).toEqual([
			'select user',
			'insert api_tokens',
		]);
	});

	test('activity checks the task is seen, reads its log rows and live comments, and names the actors', async () => {
		const path = `/api/activity?id=${taskId}`;
		expect(await statementsOf(path, { headers: owner.headers })).toEqual([
			'select tasks',
			'select log',
			'select comments',
			'select user',
		]);
		expect(await statementsOf(`${path}&${space}`, { headers: guest.headers })).toEqual([
			'select shares',
			'select tasks',
			'select log',
			'select comments',
			'select user',
		]);
	});

	test('comments check the task is seen and read only that task’s comments', async () => {
		expect(await statementsOf(`/api/comments?id=${taskId}`, { headers: owner.headers })).toEqual([
			'select tasks',
			'select comments',
			'select user',
		]);
	});

	test('the agent view is the tree and the task clients, after the caller’s grants', async () => {
		const clients = ['select tasks + log + log'];
		expect(await statementsOf('/api/view', { headers: owner.headers })).toEqual([...tree, ...clients]);
		expect(await statementsOf(`/api/view?${space}`, { headers: guest.headers })).toEqual([
			'select shares',
			...tree,
			...clients,
		]);
		expect(await statementsOf('/api/view', { headers: ai })).toEqual([...asBot, 'select shares', ...tree, ...clients]);
	});

	test('an agent edit loads the tree and the time zone, writes, and reads the task back', async () => {
		const edit = (title: string) => ({ method: 'PATCH', body: JSON.stringify({ title }) });
		const after = ['update tasks', 'insert log', 'select tasks + log + log'];
		expect(await statementsOf(`/api/tasks?id=${taskId}`, { ...edit('By the agent'), headers: owner.headers })).toEqual([
			...tree,
			'select settings',
			...after,
		]);
		expect(
			await statementsOf(`/api/tasks?id=${taskId}&${space}`, { ...edit('By the guest'), headers: guest.headers }),
		).toEqual([
			'select shares',
			...tree,
			'select settings',
			'lock',
			'select access',
			'savepoint',
			'update tasks',
			'release',
			...after.slice(1),
		]);
	});

	test('links are the space’s link shares, and a link changes one row', async () => {
		expect(await statementsOf('/api/links', { headers: owner.headers })).toEqual(['select shares']);
		const body = JSON.stringify({ target: { kind: 'task', id: taskId } });
		expect(await statementsOf('/api/links', { method: 'POST', headers: owner.headers, body })).toEqual([
			'lock',
			'select shares',
			'select tasks',
			'insert shares',
		]);
		expect(await statementsOf(`/api/shared?token=${owner.person.id}.${linkId}`)).toEqual([
			'select shares',
			'select user',
			...tree,
		]);
		expect(await statementsOf(`/api/links?id=${linkId}`, { method: 'DELETE', headers: owner.headers })).toEqual([
			'delete shares',
		]);
	});

	test('a share to a person recomputes that grantee’s access from its shares and the space’s links', async () => {
		const body = JSON.stringify({
			target: { kind: 'task', id: taskId },
			audience: { kind: 'user', userId: guest.person.id, role: 'view' },
		});
		expect(await statementsOf('/api/shares', { method: 'POST', headers: owner.headers, body })).toEqual([
			'select user',
			'lock',
			'select shares',
			'select tasks',
			'insert shares',
			'select shares',
			'select access',
			...tree,
			'insert access',
		]);
		const taskColumns = app.statements.flatMap(statement => /^select (.*?) from "tasks"/.exec(statement)?.[1] ?? []);
		expect(taskColumns).toEqual(['"id"', '"id", "parent_id", "project_id", "section_id", "label_ids"']);
	});

	test('memo tasks are found by their source key prefix, and a re-sent memo writes nothing', async () => {
		const memo = JSON.stringify({
			memoId,
			recordedAt: 1_700_000_000_000,
			tasks: [{ key: crypto.randomUUID(), title: 'Memo', notes: '', when: null, event: null }],
		});
		const put = await statementsOf('/api/memo-tasks', { method: 'PUT', headers: owner.headers, body: memo });
		expect(put.slice(0, 6)).toEqual([
			'select tasks',
			'select log',
			'select settings',
			'select tasks',
			'insert tasks',
			'insert log',
		]);
		expect(await statementsOf('/api/memo-tasks', { method: 'PUT', headers: owner.headers, body: memo })).toEqual([
			'select tasks',
			'select log',
		]);
		expect(await statementsOf(`/api/memo-tasks?memoId=${memoId}`, { headers: owner.headers })).toEqual([
			'select tasks',
		]);
		const removed = await statementsOf(`/api/memo-tasks?memoId=${memoId}`, {
			method: 'DELETE',
			headers: owner.headers,
		});
		expect(removed.slice(0, 3)).toEqual(['select tasks', 'delete tasks', 'insert log']);
	});

	test('people search is one select, with or without an email', async () => {
		expect(await statementsOf('/api/people?q=', { headers: owner.headers })).toEqual(['select shares']);
		expect(await statementsOf('/api/people?q=someone%40example.com', { headers: owner.headers })).toEqual([
			'select user',
		]);
	});

	test('a subscription plans from one read of the open tasks and the zone', async () => {
		const body = JSON.stringify({ subscription });
		await statementsOf('/api/push/subscription', { method: 'PUT', headers: owner.headers, body });
		expect(await statementsOf('/api/push/subscription', { method: 'PUT', headers: owner.headers, body })).toEqual([
			'select settings',
			'select tasks',
			'select push',
			'insert push',
		]);
	});

	test('the cron settles and replans a due user’s installs in one update each', async () => {
		const due = new Date(Date.now() + 60_000).toISOString();
		await upload(app, owner, [
			{
				op: 'patch',
				table: 'tasks',
				id: taskId,
				values: { due: JSON.stringify({ date: due.slice(0, 10), time: due.slice(11, 16) }) },
			},
		]);
		app.statements.length = 0;
		expect(await deliverDue(app.db, Date.now() + 120_000, async () => 201)).toBe(1);
		expect(app.statements.map(named)).toEqual([
			'select push',
			'select push',
			'lock',
			'select push',
			'select settings',
			'select tasks',
			'update push',
		]);
	});
});
