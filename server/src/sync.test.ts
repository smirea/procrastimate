import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
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
	device,
	syncAs,
} from './test-app';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});
afterAll(() => app.close());

const upload = (session: Session, writes: unknown[]) => uploadAs(app, session, writes);

const stored = async (id: string) => (await app.db.select().from(tasks).where(eq(tasks.id, id)))[0] ?? null;
/** The task as every reader sees it, with dangling references resolved, which the server never writes back. */
const shown = async (id: string) =>
	(await json<SpaceView>(app.fetch('/api/view', { headers: owner.headers }))).tasks.find(task => task.id === id) ??
	null;

describe('POST /api/sync', () => {
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

	test('a put that leaves out columns takes the table defaults, and one without a required column is refused', async () => {
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
		).toEqual([{ table: 'tasks', id: missing, reason: 'title: required' }]);
	});

	test('a patch changes only the columns it names, and a value of the wrong storage class is refused', async () => {
		const id = crypto.randomUUID();
		await upload(owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Eggs') }]);
		expect(
			await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { title: 'Eggs, a dozen', priority: 1 } }]),
		).toEqual([]);
		expect(await stored(id)).toMatchObject({ title: 'Eggs, a dozen', priority: 1, notes: '' });
		expect(await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { priority: '2' } }])).toEqual([
			{ table: 'tasks', id, reason: 'priority: expected INTEGER' },
		]);
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
		const { rejected } = await syncAs(app, device(owner), [
			{ op: 'put', table: 'tasks', id: bad, values: taskRow(bad, owner.person.id, 'Bad', { priority: 9 }) },
			{ op: 'put', table: 'nope', id: 'x', values: {} },
			{ op: 'put', table: 'tasks', id: good, values: taskRow(good, owner.person.id, 'Good') },
		]);
		expect(rejected.map(entry => entry.reason)).toEqual([
			'priority: Invalid option: expected one of 1|2|3|4',
			'unknown table nope',
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

	test('every applied write is logged with its actor, op, fields, the client, and the device’s op id', async () => {
		const id = crypto.randomUUID();
		const phone = device(owner);
		await syncAs(app, phone, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Logged') }]);
		const rows = await app.db.select().from(log).where(eq(log.id, id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: owner.person.id,
			kind: 'task',
			op: 'put',
			actor: owner.person.id,
			opId: `${phone.client}:1`,
			client: { kind: 'web', device: 'test' },
		});
		expect(rows[0]!.fields).toMatchObject({ title: 'Logged' });
	});

	test('a resent batch applies once and adds no second log row', async () => {
		const id = crypto.randomUUID();
		const phone = device(owner);
		const batch = [
			{ op: 'put' as const, table: 'tasks', id, values: taskRow(id, owner.person.id, 'Retried') },
			{ op: 'patch' as const, table: 'tasks', id, values: { title: 'Edited once' } },
		];
		expect((await syncAs(app, phone, batch)).rejected).toEqual([]);
		await upload(owner, [{ op: 'patch', table: 'tasks', id, values: { title: 'Edited elsewhere' } }]);
		phone.seq = 0;
		expect((await syncAs(app, phone, batch)).acked).toBe(2);
		expect(await stored(id)).toMatchObject({ title: 'Edited elsewhere', createdBy: owner.person.id });
		const rows = await app.db.select({ op: log.op }).from(log).where(eq(log.id, id));
		expect(rows.map(row => row.op)).toEqual(['put', 'patch', 'patch']);
	});

	test('settings and reads live in the actor’s own space, keyed by the user and by user and task', async () => {
		const taskId = crypto.randomUUID();
		const reader = await signUp(app, 'Reader');
		const readOf = (user: string) => `${user}:${taskId}`;
		expect(
			await upload(reader, [
				{ op: 'put', table: 'reads', id: readOf(reader.person.id), values: { user_id: owner.person.id, read_at: 7 } },
				{ op: 'put', table: 'reads', id: readOf(owner.person.id), values: { user_id: reader.person.id, read_at: 9 } },
			]),
		).toEqual([{ table: 'reads', id: readOf(owner.person.id), reason: 'Read markers belong to their reader' }]);
		expect(
			await upload(owner, [
				{ op: 'put', table: 'reads', id: readOf(owner.person.id), values: { user_id: owner.person.id, read_at: 5 } },
				{ op: 'patch', table: 'settings', id: reader.person.id, values: { time_zone: 'Europe/Madrid' } },
				{ op: 'put', table: 'settings', id: 'other-id', values: { user_id: owner.person.id } },
			]),
		).toEqual([
			{ table: 'settings', id: reader.person.id, reason: 'Settings belong to their user' },
			{ table: 'settings', id: 'other-id', reason: 'Settings belong to their user' },
		]);
		expect(await app.db.select().from(reads).orderBy(reads.readAt)).toEqual([
			{ id: readOf(owner.person.id), userId: owner.person.id, readAt: 5 },
			{ id: readOf(reader.person.id), userId: reader.person.id, readAt: 7 },
		]);
		expect(
			await app.db.select({ timeZone: settings.timeZone }).from(settings).where(eq(settings.userId, reader.person.id)),
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

	test('settings exist from sign-up, a put never overwrites them, a patch changes them, and a delete is refused', async () => {
		const me = await signUp(app, 'Settled');
		const id = me.person.id;
		const row = async () => (await app.db.select().from(settings).where(eq(settings.userId, id)))[0] ?? null;
		expect(await row()).toMatchObject({ id, timeZone: null, dictation: 'native' });
		expect(
			await upload(me, [
				{
					op: 'put',
					table: 'settings',
					id,
					values: { user_id: id, time_zone: 'Europe/Madrid', dictation: 'elevenlabs', quick_add_buttons: '[]' },
				},
			]),
		).toEqual([]);
		expect(await row()).toMatchObject({ timeZone: null, dictation: 'native' });
		expect(await upload(me, [{ op: 'patch', table: 'settings', id, values: { time_zone: 'Europe/Madrid' } }])).toEqual(
			[],
		);
		expect(await row()).toMatchObject({ timeZone: 'Europe/Madrid', dictation: 'native' });
		expect(await upload(me, [{ op: 'delete', table: 'settings', id }])).toEqual([
			{ table: 'settings', id, reason: 'Settings cannot be deleted' },
		]);
		expect(await row()).toMatchObject({ timeZone: 'Europe/Madrid' });
	});

	test('the access table is the server’s alone', async () => {
		const id = `${owner.person.id}:task:x`;
		expect(
			await upload(owner, [
				{
					op: 'put',
					table: 'access',
					id,
					values: { grantee: owner.person.id, owner: 'someone', kind: 'task', entity_id: 'x', role: 'edit' },
				},
			]),
		).toEqual([{ table: 'access', id, reason: 'Only the server writes access' }]);
	});

	test('an AI token may not sync', async () => {
		const { headers } = await aiAccount(app, owner);
		const response = await app.fetch('/api/sync', {
			method: 'POST',
			headers,
			body: JSON.stringify({ protocol: 2, client: 'bot', cursor: 0, writes: [] }),
		});
		expect(response.status).toBe(403);
	});

	test('without a session the route is 401', async () => {
		const response = await app.fetch('/api/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ protocol: 2, client: 'anon', cursor: 0, writes: [] }),
		});
		expect(response.status).toBe(401);
	});

	test('a device pulls its own rows, its grants, and what they open, comments included, and loses them on revoke', async () => {
		const host = await signUp(app, 'Host');
		const guest = await signUp(app, 'Guest');
		const [shared, hidden, comment] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		await upload(host, [
			{ op: 'put', table: 'tasks', id: shared, values: taskRow(shared, host.person.id, 'Shared') },
			{ op: 'put', table: 'tasks', id: hidden, values: taskRow(hidden, host.person.id, 'Hidden') },
			{
				op: 'put',
				table: 'comments',
				id: comment,
				values: { user_id: host.person.id, task_id: shared, body: 'Hi', created_at: 1 },
			},
		]);
		const phone = device(guest);
		const keys = (rows: { table: string; id: string; deleted: number }[]) =>
			rows.map(row => `${row.table}:${row.id === guest.person.id ? 'me' : row.id}:${row.deleted}`).toSorted();
		expect(keys((await syncAs(app, phone)).rows)).toEqual(['settings:me:0']);

		const share = await shareWith(app, host, { kind: 'task', id: shared }, guest.person.id, 'view');
		const opened = await syncAs(app, phone);
		expect(opened.snapshot).toBe(false);
		expect(keys(opened.rows)).toEqual(
			[`access:${guest.person.id}:task:${shared}:0`, `comments:${comment}:0`, `tasks:${shared}:0`].toSorted(),
		);
		expect(keys((await syncAs(app, device(guest))).rows)).toEqual(
			[
				'settings:me:0',
				`access:${guest.person.id}:task:${shared}:0`,
				`comments:${comment}:0`,
				`tasks:${shared}:0`,
			].toSorted(),
		);

		await upload(host, [{ op: 'patch', table: 'tasks', id: hidden, values: { title: 'Still hidden' } }]);
		await upload(host, [{ op: 'patch', table: 'tasks', id: shared, values: { title: 'Renamed' } }]);
		const delta = await syncAs(app, phone);
		expect(keys(delta.rows)).toEqual([`tasks:${shared}:0`]);

		await app.fetch(`/api/shares?id=${share.id}`, { method: 'DELETE', headers: host.headers });
		expect(keys((await syncAs(app, phone)).rows)).toEqual(
			[`access:${guest.person.id}:task:${shared}:1`, `comments:${comment}:1`, `tasks:${shared}:1`].toSorted(),
		);
	});

	test('a guest’s refused write to a row it cannot see comes back as a tombstone', async () => {
		const host = await signUp(app, 'Host');
		const guest = await signUp(app, 'Guest');
		const id = crypto.randomUUID();
		await upload(host, [{ op: 'put', table: 'tasks', id, values: taskRow(id, host.person.id, 'Private') }]);
		const response = await syncAs(app, device(guest), [
			{ op: 'patch', table: 'tasks', id, values: { title: 'Peeked' } },
		]);
		expect(response.rejected.map(r => r.reason)).toEqual(['Not shared with you']);
		expect(response.rows.filter(row => row.table === 'tasks')).toEqual([{ table: 'tasks', id, deleted: 1 }]);
	});
});
