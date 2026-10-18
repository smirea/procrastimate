import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { log, reads, settings, tasks } from '../../shared/db/schema';
import type { SpaceView } from '../../shared/sharing';
import {
	aiAccount,
	json,
	type Session,
	shareWith,
	signUp,
	taskRow,
	testApp,
	type TestApp,
	upload as uploadAs,
} from './test-app';

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
/** The task as every reader sees it, with dangling references resolved, which the server never writes back. */
const shown = async (id: string) =>
	(await json<SpaceView>(app.fetch('/api/view', { headers: owner.headers }))).tasks.find(task => task.id === id) ??
	null;

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

	test('three devices race: a put into a deleted section, a label put back after its delete, and an undo after another device’s edit', async () => {
		const me = owner.person.id;
		const projectId = crypto.randomUUID();
		const sectionId = crypto.randomUUID();
		const homeId = crypto.randomUUID();
		const urgentId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const lateId = crypto.randomUUID();
		const project = { id: projectId, user_id: me, name: 'Work', created_at: 1 };
		const section = { id: sectionId, user_id: me, project_id: projectId, name: 'Later', created_at: 1 };
		const place = JSON.stringify({ address: null, latitude: 52.52, longitude: 13.405, radius: 100 });
		const task = taskRow(taskId, me, 'Water the plants', { projectId, sectionId, labelIds: JSON.stringify([homeId]) });
		expect(
			await upload(owner, [
				{ op: 'put', table: 'projects', id: projectId, values: project },
				{ op: 'put', table: 'sections', id: sectionId, values: section },
				{
					op: 'put',
					table: 'labels',
					id: homeId,
					values: { id: homeId, user_id: me, name: 'Home', place, created_at: 1 },
				},
				{
					op: 'put',
					table: 'labels',
					id: urgentId,
					values: { id: urgentId, user_id: me, name: 'Urgent', created_at: 1 },
				},
				{ op: 'put', table: 'tasks', id: taskId, values: task },
			]),
		).toEqual([]);

		// A deletes the section, which takes its task along as `deleteSection` does. B, still showing the section, adds
		// a task into it and labels the first one: the new task is stored as sent and reads as in the project with no
		// section, the patch changes nothing.
		expect(
			await upload(owner, [
				{ op: 'delete', table: 'sections', id: sectionId },
				{ op: 'delete', table: 'tasks', id: taskId },
			]),
		).toEqual([]);
		expect(
			await upload(owner, [
				{
					op: 'put',
					table: 'tasks',
					id: lateId,
					values: taskRow(lateId, me, 'Added into Later', { projectId, sectionId }),
				},
				{ op: 'patch', table: 'tasks', id: taskId, values: { label_ids: JSON.stringify([homeId, urgentId]) } },
			]),
		).toEqual([]);
		expect(await stored(lateId)).toMatchObject({ projectId, sectionId });
		expect(await shown(lateId)).toMatchObject({ projectId, sectionId: null });
		expect(await stored(taskId)).toBeNull();

		// A undoes, as the toast does, by putting the section and task back as they were, and B's task reads as in the
		// section again.
		expect(
			await upload(owner, [
				{ op: 'put', table: 'sections', id: sectionId, values: section },
				{ op: 'put', table: 'tasks', id: taskId, values: task },
			]),
		).toEqual([]);
		expect(await stored(taskId)).toMatchObject({ sectionId, labelIds: [homeId] });
		expect(await shown(lateId)).toMatchObject({ projectId, sectionId });

		// C deletes the Home place while B, offline since before, puts it on the task again next to Urgent: the row keeps
		// both, and readers drop the deleted one.
		expect(
			await upload(owner, [
				{ op: 'patch', table: 'tasks', id: taskId, values: { label_ids: '[]' } },
				{ op: 'delete', table: 'labels', id: homeId },
			]),
		).toEqual([]);
		expect(
			await upload(owner, [
				{ op: 'patch', table: 'tasks', id: taskId, values: { label_ids: JSON.stringify([homeId, urgentId]) } },
			]),
		).toEqual([]);
		expect(await stored(taskId)).toMatchObject({ labelIds: [homeId, urgentId] });
		expect(await shown(taskId)).toMatchObject({ labelIds: [urgentId] });

		// A deletes the whole project, B edits the task meanwhile, and A undoes after B's edit landed: the delete made the
		// edit a no-op, and the undo's put brings the task back as A last saw it.
		expect(
			await upload(owner, [
				{ op: 'delete', table: 'projects', id: projectId },
				{ op: 'delete', table: 'sections', id: sectionId },
				{ op: 'delete', table: 'tasks', id: taskId },
				{ op: 'delete', table: 'tasks', id: lateId },
			]),
		).toEqual([]);
		expect(
			await upload(owner, [{ op: 'patch', table: 'tasks', id: taskId, values: { title: 'Water the ferns' } }]),
		).toEqual([]);
		expect(await stored(taskId)).toBeNull();
		const restored = { ...task, label_ids: JSON.stringify([urgentId]) };
		expect(
			await upload(owner, [
				{ op: 'put', table: 'projects', id: projectId, values: project },
				{ op: 'put', table: 'sections', id: sectionId, values: section },
				{ op: 'put', table: 'tasks', id: taskId, values: restored },
				{ op: 'put', table: 'tasks', id: lateId, values: taskRow(lateId, me, 'Added into Later', { projectId }) },
			]),
		).toEqual([]);
		expect(await stored(taskId)).toMatchObject({
			title: 'Water the plants',
			projectId,
			sectionId,
			labelIds: [urgentId],
		});
		expect(await stored(lateId)).toMatchObject({ projectId, sectionId: null });
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

	test('the server repairs nothing: a subtask stored with its own project reads with its root’s', async () => {
		const parent = crypto.randomUUID();
		const projectId = crypto.randomUUID();
		const child = crypto.randomUUID();
		await upload(owner, [
			{
				op: 'put',
				table: 'projects',
				id: projectId,
				values: { id: projectId, user_id: owner.person.id, name: 'Home', created_at: 1_700_000_000_000 },
			},
			{ op: 'put', table: 'tasks', id: parent, values: taskRow(parent, owner.person.id, 'Parent', { projectId }) },
			{
				op: 'put',
				table: 'tasks',
				id: child,
				values: taskRow(child, owner.person.id, 'Child', { parentId: parent, projectId: null }),
			},
		]);
		expect(await stored(child)).toMatchObject({ parentId: parent, projectId: null });
		expect(await shown(child)).toMatchObject({ parentId: parent, projectId });
		expect(await app.db.select().from(log).where(eq(log.actor, 'server'))).toEqual([]);
	});

	test('every applied write is logged with its actor, op, fields, the client, and the client’s op id', async () => {
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
			client: { kind: 'web', device: 'test' },
		});
		expect(rows[0]!.fields).toMatchObject({ title: 'Logged' });
	});

	test('a retried batch converges and adds no second log row', async () => {
		const id = crypto.randomUUID();
		const other = crypto.randomUUID();
		const batch = [
			{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Retried'), opId: `${id}:1` },
			{ op: 'patch', table: 'tasks', id: other, values: { title: 'nobody' }, opId: `${id}:2` },
			{
				op: 'put',
				table: 'reads',
				id: other,
				values: { id: other, user_id: owner.person.id, read_at: 5 },
				opId: `${id}:3`,
			},
		];
		expect(await upload(owner, batch)).toEqual([]);
		expect(await upload(owner, batch)).toEqual([]);
		expect(await stored(id)).toMatchObject({ title: 'Retried', createdBy: owner.person.id });
		const rows = await app.db
			.select({ kind: log.kind, id: log.id })
			.from(log)
			.where(and(eq(log.userId, owner.person.id), sql`${log.opId} LIKE ${`${id}:%`}`));
		expect(rows.toSorted((a, b) => a.kind.localeCompare(b.kind))).toEqual([
			{ kind: 'read', id: other },
			{ kind: 'task', id },
		]);
	});

	test('settings and reads live in the actor’s own space, keyed by the fixed id and the task id', async () => {
		const taskId = crypto.randomUUID();
		const reader = await signUp(app, 'Reader');
		expect(
			await upload(reader, [
				{ op: 'put', table: 'reads', id: taskId, values: { id: taskId, user_id: owner.person.id, read_at: 7 } },
			]),
		).toEqual([]);
		expect(await app.db.select().from(reads).where(eq(reads.id, taskId))).toEqual([
			{ userId: reader.person.id, id: taskId, readAt: 7 },
		]);
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
		expect(await app.db.select().from(reads).where(eq(reads.id, taskId)).orderBy(reads.readAt)).toEqual([
			{ userId: owner.person.id, id: taskId, readAt: 5 },
			{ userId: reader.person.id, id: taskId, readAt: 7 },
		]);
		// The row exists from sign-up, and a settings put only ever creates a missing one.
		expect(
			await app.db.select({ timeZone: settings.timeZone }).from(settings).where(eq(settings.userId, owner.person.id)),
		).toEqual([{ timeZone: null }]);
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

	test('a write the database refuses is rejected alone, with a 200, and the rest of the batch still applies', async () => {
		await app.db.execute(sql`ALTER TABLE tasks ADD CONSTRAINT refused CHECK (title <> 'refused by the database')`);
		try {
			await refusedWrite();
		} finally {
			await app.db.execute(sql`ALTER TABLE tasks DROP CONSTRAINT refused`);
		}
	});

	async function refusedWrite() {
		const host = await signUp(app, 'Host');
		const [theirs, refusedTheirs] = [crypto.randomUUID(), crypto.randomUUID()];
		for (const id of [theirs, refusedTheirs]) {
			await upload(host, [{ op: 'put', table: 'tasks', id, values: taskRow(id, host.person.id, 'Theirs') }]);
			await shareWith(app, host, { kind: 'task', id }, owner.person.id, 'edit');
		}
		const mine = crypto.randomUUID();
		const response = await app.fetch('/api/upload', {
			method: 'POST',
			headers: owner.headers,
			body: JSON.stringify({
				writes: [
					{ op: 'patch', table: 'tasks', id: theirs, values: { title: 'Theirs, edited by the guest' } },
					{ op: 'patch', table: 'tasks', id: refusedTheirs, values: { title: 'refused by the database' } },
					{ op: 'put', table: 'tasks', id: mine, values: taskRow(mine, owner.person.id, 'refused by the database') },
				],
			}),
		});
		expect(response.status).toBe(200);
		const { rejected } = (await response.json()) as { rejected: Rejected };
		expect(rejected.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
			[
				{ table: 'tasks', id: mine, reason: 'The database refused the write' },
				{ table: 'tasks', id: refusedTheirs, reason: 'The database refused the write' },
			].toSorted((a, b) => a.id.localeCompare(b.id)),
		);
		expect(await stored(theirs)).toMatchObject({ title: 'Theirs, edited by the guest' });
		expect(await stored(refusedTheirs)).toMatchObject({ title: 'Theirs' });
		expect(await stored(mine)).toBeNull();
	}

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

	test('an AI token may not upload', async () => {
		const { headers } = await aiAccount(app, owner);
		const response = await app.fetch('/api/upload', {
			method: 'POST',
			headers,
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
