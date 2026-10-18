import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { log, settings, taskClients, tasks } from '../../shared/db/schema';
import type { Person } from '../../shared/sharing';
import {
	json,
	signUp,
	taskRow,
	testApp,
	tokenHeaders,
	upload as uploadAs,
	type Session,
	type TestApp,
} from './test-app';

/**
 * `POST /api/upload` through the route, as a client's PowerSync queue sends it: snake_case columns and JSON as text.
 * Every case asserts what another device would then see in Postgres.
 */

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});
afterAll(() => app.close());

const upload = (session: Session, writes: unknown[]) => uploadAs(app, session, writes);
type Rejected = { table: string; id: string; reason: string }[];

const stored = async (id: string) => (await app.db.select().from(tasks).where(eq(tasks.id, id)))[0] ?? null;

describe('POST /api/upload', () => {
	test('a put lands as the actor’s row, with created_by stamped and the client’s value ignored', async () => {
		const id = crypto.randomUUID();
		expect(
			await upload(owner, [
				{
					op: 'put',
					table: 'tasks',
					id,
					values: taskRow(id, owner.person.id, 'Milk', { createdBy: 'liar', priority: 2 }),
				},
			]),
		).toEqual([]);
		const row = await stored(id);
		expect(row).toMatchObject({
			id,
			userId: owner.person.id,
			title: 'Milk',
			priority: 2,
			createdBy: owner.person.id,
			labelIds: [],
		});
	});

	test('a put that leaves out columns, as PowerSync does for nulls, takes the table defaults', async () => {
		const id = crypto.randomUUID();
		expect(
			await upload(owner, [
				{ op: 'put', table: 'tasks', id, values: { id, user_id: owner.person.id, title: 'Sparse', created_at: 1 } },
			]),
		).toEqual([]);
		expect(await stored(id)).toMatchObject({
			title: 'Sparse',
			notes: '',
			priority: 4,
			labelIds: [],
			reminders: [],
			images: [],
			due: null,
			parentId: null,
			projectId: null,
			completedAt: null,
			sourceKey: null,
		});
		const missing = crypto.randomUUID();
		expect(
			await upload(owner, [
				{ op: 'put', table: 'tasks', id: missing, values: { id: missing, user_id: owner.person.id } },
			]),
		).toEqual([{ table: 'tasks', id: missing, reason: 'title: Invalid input: expected string, received undefined' }]);
	});

	test('a patch changes only the columns it names, and numeric text is read as a number', async () => {
		const id = crypto.randomUUID();
		await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Eggs') }]);
		expect(
			await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { title: 'Eggs, a dozen', priority: '1' } }]),
		).toEqual([]);
		expect(await stored(id)).toMatchObject({ title: 'Eggs, a dozen', priority: 1, notes: '' });
	});

	test('completing stamps completed_by, reopening clears it, and a recurring roll stamps it again', async () => {
		const id = crypto.randomUUID();
		await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Gym') }]);
		await upload(owner, [
			{ op: 'patch', table: 'tasks', id, values: { completed_at: 1_700_000_001_000, completed_by: 'liar' } },
		]);
		expect(await stored(id)).toMatchObject({ completedAt: 1_700_000_001_000, completedBy: owner.person.id });
		await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { completed_at: null } }]);
		expect(await stored(id)).toMatchObject({ completedAt: null, completedBy: null });
		await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { last_completed_at: 1_700_000_002_000 } }]);
		expect(await stored(id)).toMatchObject({ lastCompletedAt: 1_700_000_002_000, completedBy: owner.person.id });
	});

	test('one bad write is rejected alone with a 200, and the rest of the batch still applies', async () => {
		const good = crypto.randomUUID();
		const bad = crypto.randomUUID();
		const response = await app.fetch('/api/upload', {
			method: 'POST',
			headers: owner.headers,
			body: JSON.stringify({
				writes: [
					{ op: 'put', table: 'tasks', id: bad, values: taskRow(bad, owner.person.id, 'Bad', { priority: 9 }) },
					'garbage',
					{ op: 'put', table: 'nope', id: 'x', values: {} },
					{ op: 'put', table: 'tasks', id: good, values: taskRow(good, owner.person.id, 'Good') },
				],
			}),
		});
		expect(response.status).toBe(200);
		const { rejected } = (await response.json()) as { rejected: Rejected };
		expect(rejected.map(entry => entry.reason)).toEqual([
			'priority: Invalid option: expected one of 1|2|3|4',
			'Malformed write',
			'Unknown table nope',
		]);
		expect(await stored(good)).toMatchObject({ title: 'Good' });
		expect(await stored(bad)).toBeNull();
	});

	test('a write into another user’s space is refused and no row appears', async () => {
		const other = await signUp(app, 'Other');
		const id = crypto.randomUUID();
		expect(
			await upload(other, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Intruder') }]),
		).toEqual([{ table: 'tasks', id, reason: 'Not shared with you' }]);
		expect(await stored(id)).toBeNull();
	});

	test('a delete removes the row, a later patch changes nothing, and a re-put brings it back', async () => {
		const id = crypto.randomUUID();
		await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Undo me') }]);
		expect(await upload(owner, [{ op: 'delete', table: 'tasks', id }])).toEqual([]);
		expect(await stored(id)).toBeNull();
		expect(await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { title: 'late edit' } }])).toEqual([]);
		expect(await stored(id)).toBeNull();
		expect(
			await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Undo me') }]),
		).toEqual([]);
		expect(await stored(id)).toMatchObject({ title: 'Undo me', createdBy: owner.person.id });
	});

	test('a batch with several writes to one row folds them, so the last value wins', async () => {
		const id = crypto.randomUUID();
		expect(
			await upload(owner, [
				{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'First') },
				{ op: 'patch', table: 'tasks', id, values: { title: 'Second' } },
				{ op: 'patch', table: 'tasks', id, values: { priority: 3 } },
			]),
		).toEqual([]);
		expect(await stored(id)).toMatchObject({ title: 'Second', priority: 3 });
	});

	test('fixups repair what the client sent: a subtask with its own project takes its parent’s', async () => {
		const parent = crypto.randomUUID();
		const projectId = crypto.randomUUID();
		const child = crypto.randomUUID();
		await upload(owner, [
			{
				op: 'put',
				table: 'projects',
				id: projectId,
				values: {
					id: projectId,
					user_id: owner.person.id,
					name: 'Home',
					order: 0,
					created_at: 1_700_000_000_000,
					source_key: null,
				},
			},
			{ op: 'put', table: 'tasks', id: parent, values: taskRow(parent, owner.person.id, 'Parent', { projectId }) },
			{
				op: 'put',
				table: 'tasks',
				id: child,
				values: taskRow(child, owner.person.id, 'Child', { parentId: parent, projectId: null }),
			},
		]);
		expect(await stored(child)).toMatchObject({ parentId: parent, projectId });
		const repairs = await app.db.select().from(log).where(eq(log.actor, 'server'));
		expect(repairs.some(row => row.id === child && row.op === 'patch')).toBe(true);
	});

	test('every applied write is logged with its actor, op, fields, and the client’s op id', async () => {
		const id = crypto.randomUUID();
		await upload(owner, [
			{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Logged'), opId: 'client-op-7' },
		]);
		const rows = await app.db.select().from(log).where(eq(log.id, id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: owner.person.id,
			kind: 'task',
			op: 'put',
			actor: owner.person.id,
			opId: 'client-op-7',
		});
		expect(rows[0]!.fields).toMatchObject({ title: 'Logged', createdBy: owner.person.id });
	});

	test('task_clients records the creating app and the last editing app', async () => {
		const id = crypto.randomUUID();
		await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Clients') }]);
		const api = { ...owner.headers, 'user-agent': 'curl/8' };
		delete (api as Record<string, string>)['x-procrastimate-client'];
		await app.fetch('/api/upload', {
			method: 'POST',
			headers: api,
			body: JSON.stringify({ writes: [{ op: 'patch', table: 'tasks', id, values: { title: 'Edited by api' } }] }),
		});
		const [row] = await app.db.select().from(taskClients).where(eq(taskClients.id, id));
		expect(row?.created).toMatchObject({ kind: 'web' });
		expect(row?.edited).toMatchObject({ kind: 'api', device: 'curl/8' });
	});

	test('settings and reads live in the actor’s own space, keyed by the fixed id and the task id', async () => {
		const taskId = crypto.randomUUID();
		expect(
			await upload(owner, [
				{
					op: 'put',
					table: 'settings',
					id: 'settings',
					values: {
						id: 'settings',
						user_id: owner.person.id,
						time_zone: 'Europe/Madrid',
						dictation: 'native',
						quick_add_buttons: '["date"]',
					},
				},
				{ op: 'put', table: 'reads', id: taskId, values: { id: taskId, user_id: owner.person.id, read_at: 5 } },
				{
					op: 'put',
					table: 'settings',
					id: 'other-id',
					values: {
						id: 'other-id',
						user_id: owner.person.id,
						time_zone: null,
						dictation: 'native',
						quick_add_buttons: '[]',
					},
				},
			]),
		).toEqual([{ table: 'settings', id: 'other-id', reason: 'Settings rows are named settings' }]);
	});

	test('a put that names another user’s row is refused, whatever user_id it claims', async () => {
		const other = await signUp(app, 'Other');
		const id = crypto.randomUUID();
		await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Mine') }]);
		expect(
			await upload(other, [{ op: 'put', table: 'tasks', id, values: taskRow(id, other.person.id, 'PWNED') }]),
		).toEqual([{ table: 'tasks', id, reason: 'Belongs to another space' }]);
		expect(await stored(id)).toMatchObject({ userId: owner.person.id, title: 'Mine', createdBy: owner.person.id });
	});

	test('text with U+0000 is refused at the boundary, not by the database', async () => {
		const id = crypto.randomUUID();
		expect(
			await upload(owner, [
				{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'a\u0000b') },
				{ op: 'patch', table: 'tasks', id, values: { label_ids: JSON.stringify(['x\u0000']) } },
			]),
		).toEqual([
			{ table: 'tasks', id, reason: 'Text cannot contain U+0000' },
			{ table: 'tasks', id, reason: 'Text cannot contain U+0000' },
		]);
		expect(await stored(id)).toBeNull();
	});

	test('a write the database refuses rejects that space’s writes alone, with a 200, and the other space still applies', async () => {
		await app.db.execute(sql`ALTER TABLE tasks ADD CONSTRAINT refused CHECK (title <> 'refused by the database')`);
		const host = await signUp(app, 'Host');
		const theirs = crypto.randomUUID();
		await upload(host, [{ op: 'put', table: 'tasks', id: theirs, values: taskRow(theirs, host.person.id, 'Theirs') }]);
		await json(
			app.fetch('/api/shares', {
				method: 'POST',
				headers: host.headers,
				body: JSON.stringify({
					target: { kind: 'task', id: theirs },
					audience: { kind: 'user', userId: owner.person.id, role: 'edit' },
				}),
			}),
		);
		const mine = crypto.randomUUID();
		const response = await app.fetch('/api/upload', {
			method: 'POST',
			headers: owner.headers,
			body: JSON.stringify({
				writes: [
					{ op: 'patch', table: 'tasks', id: theirs, values: { title: 'Theirs, edited by the guest' } },
					{ op: 'put', table: 'tasks', id: mine, values: taskRow(mine, owner.person.id, 'refused by the database') },
				],
			}),
		});
		expect(response.status).toBe(200);
		const { rejected } = (await response.json()) as { rejected: Rejected };
		expect(rejected).toEqual([{ table: 'tasks', id: mine, reason: 'The database refused the write' }]);
		expect(await stored(theirs)).toMatchObject({ title: 'Theirs, edited by the guest' });
		expect(await stored(mine)).toBeNull();
		await app.db.execute(sql`ALTER TABLE tasks DROP CONSTRAINT refused`);
	});

	test('settings exist from sign-up, a put never overwrites them, a patch changes them, and a delete is refused', async () => {
		const me = await signUp(app, 'Settled');
		const row = async () => (await app.db.select().from(settings).where(eq(settings.userId, me.person.id)))[0] ?? null;
		expect(await row()).toMatchObject({ id: 'settings', timeZone: null, dictation: 'native' });
		expect(
			await upload(me, [
				{
					op: 'put',
					table: 'settings',
					id: 'settings',
					values: {
						id: 'settings',
						user_id: me.person.id,
						time_zone: 'Europe/Madrid',
						dictation: 'elevenlabs',
						quick_add_buttons: '[]',
					},
				},
			]),
		).toEqual([]);
		expect(await row()).toMatchObject({ timeZone: null, dictation: 'native' });
		expect(
			await upload(me, [{ op: 'patch', table: 'settings', id: 'settings', values: { time_zone: 'Europe/Madrid' } }]),
		).toEqual([]);
		expect(await row()).toMatchObject({ timeZone: 'Europe/Madrid', dictation: 'native' });
		expect(await upload(me, [{ op: 'delete', table: 'settings', id: 'settings' }])).toEqual([
			{ table: 'settings', id: 'settings', reason: 'Settings cannot be deleted' },
		]);
		expect(await row()).toMatchObject({ timeZone: 'Europe/Madrid' });
	});

	test('a replayed write that changes nothing, or a patch to a missing task, leaves task_clients alone', async () => {
		const id = crypto.randomUUID();
		const values = taskRow(id, owner.person.id, 'Replayed');
		await upload(owner, [{ op: 'put', table: 'tasks', id, values }]);
		const ghost = crypto.randomUUID();
		const api = { ...owner.headers, 'user-agent': 'curl/8' };
		delete (api as Record<string, string>)['x-procrastimate-client'];
		await app.fetch('/api/upload', {
			method: 'POST',
			headers: api,
			body: JSON.stringify({
				writes: [
					{ op: 'put', table: 'tasks', id, values },
					{ op: 'patch', table: 'tasks', id: ghost, values: { title: 'ghost' } },
				],
			}),
		});
		const [row] = await app.db.select().from(taskClients).where(eq(taskClients.id, id));
		expect(row?.edited).toMatchObject({ kind: 'web' });
		expect(await app.db.select().from(taskClients).where(eq(taskClients.id, ghost))).toEqual([]);
	});

	test('an AI token may not upload', async () => {
		const ai = await json<Person>(
			app.fetch('/api/ai', { method: 'POST', headers: owner.headers, body: JSON.stringify({ name: 'Bot' }) }),
		);
		const { token } = await json<{ token: string }>(
			app.fetch('/api/ai-tokens', {
				method: 'POST',
				headers: owner.headers,
				body: JSON.stringify({ aiUserId: ai.id, name: 'laptop' }),
			}),
		);
		const response = await app.fetch('/api/upload', {
			method: 'POST',
			headers: tokenHeaders(token),
			body: JSON.stringify({ writes: [] }),
		});
		expect(response.status).toBe(403);
	});

	test('without a session the route is 401, the one status PowerSync may see', async () => {
		const response = await app.fetch('/api/upload', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"writes":[]}',
		});
		expect(response.status).toBe(401);
	});
});
