import { afterAll, beforeAll, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { comments, log } from '../../shared/db/schema';
import { type Session, shareWith, signUp, taskRow, testApp, type TestApp, upload as uploadAs } from './test-app';

let app: TestApp;
let owner: Session;
let guest: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
	guest = await signUp(app, 'Guest');
});
afterAll(() => app.close());

const upload = async (session: Session, writes: unknown[]) => expect(await uploadAs(app, session, writes)).toEqual([]);

/** A space's log as `kind op id by actor`, in write order. */
const logOf = async (space: string) =>
	(await app.db.select().from(log).where(eq(log.userId, space)).orderBy(asc(log.seq))).map(
		row => `${row.kind} ${row.op} ${row.id} by ${row.actor === owner.person.id ? 'owner' : 'guest'}`,
	);

test('emptying the space drops the history of every row that is gone, and leaves other spaces and live rows alone', async () => {
	const me = owner.person.id;
	const projectId = crypto.randomUUID();
	const labelId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const theirsId = crypto.randomUUID();
	await upload(owner, [
		{ op: 'patch', table: 'settings', id: me, values: { dictation: 'elevenlabs' } },
		{
			op: 'put',
			table: 'projects',
			id: projectId,
			values: { id: projectId, user_id: me, name: 'Work', created_at: 1 },
		},
		{ op: 'put', table: 'labels', id: labelId, values: { id: labelId, user_id: me, name: 'Home', created_at: 1 } },
		{ op: 'put', table: 'tasks', id: taskId, values: taskRow(taskId, me, 'Shared', { projectId }) },
		{ op: 'put', table: 'reads', id: `${me}:${taskId}`, values: { user_id: me, read_at: 1 } },
	]);
	await upload(guest, [
		{ op: 'put', table: 'tasks', id: theirsId, values: taskRow(theirsId, guest.person.id, 'Theirs') },
	]);
	await shareWith(app, owner, { kind: 'task', id: taskId }, guest.person.id, 'edit');
	await shareWith(app, guest, { kind: 'task', id: theirsId }, me, 'edit');
	await upload(guest, [{ op: 'patch', table: 'tasks', id: taskId, values: { title: 'By the guest' } }]);
	await upload(owner, [{ op: 'patch', table: 'tasks', id: theirsId, values: { title: 'By the owner' } }]);
	const guestLog = await logOf(guest.person.id);
	expect(guestLog).toEqual([`task put ${theirsId} by guest`, `task patch ${theirsId} by owner`]);

	const deleteTask = [
		{ op: 'delete', table: 'tasks', id: taskId, opId: 'delete-task' },
		{ op: 'delete', table: 'reads', id: `${me}:${taskId}`, opId: 'delete-read' },
	];
	await upload(owner, deleteTask);
	expect(await logOf(me)).toEqual([
		`settings patch ${me} by owner`,
		`project put ${projectId} by owner`,
		`label put ${labelId} by owner`,
		`task put ${taskId} by owner`,
		`read put ${me}:${taskId} by owner`,
		`task patch ${taskId} by guest`,
		`task delete ${taskId} by owner`,
		`read delete ${me}:${taskId} by owner`,
	]);

	const deleteRest = [
		{ op: 'delete', table: 'projects', id: projectId, opId: 'delete-project' },
		{ op: 'delete', table: 'labels', id: labelId, opId: 'delete-label' },
	];
	await upload(owner, deleteRest);
	expect(await logOf(me)).toEqual([`settings patch ${me} by owner`]);
	expect(await logOf(guest.person.id)).toEqual(guestLog);

	await upload(owner, [...deleteTask, ...deleteRest]);
	expect(await logOf(me)).toEqual([`settings patch ${me} by owner`]);

	const nextId = crypto.randomUUID();
	await upload(owner, [{ op: 'put', table: 'tasks', id: nextId, values: taskRow(nextId, me, 'Fresh start') }]);
	expect(await logOf(me)).toEqual([`settings patch ${me} by owner`, `task put ${nextId} by owner`]);
});

test('a guest’s delete that empties the owner’s space purges nothing', async () => {
	const lonely = await signUp(app, 'Lonely');
	const taskId = crypto.randomUUID();
	await upload(lonely, [{ op: 'put', table: 'tasks', id: taskId, values: taskRow(taskId, lonely.person.id, 'Only') }]);
	await shareWith(app, lonely, { kind: 'task', id: taskId }, guest.person.id, 'edit');
	await upload(guest, [{ op: 'delete', table: 'tasks', id: taskId }]);
	expect(
		(await app.db.select().from(log).where(eq(log.userId, lonely.person.id)).orderBy(asc(log.seq))).map(
			row => `${row.kind} ${row.op}`,
		),
	).toEqual(['task put', 'task delete']);
});

test('emptying the space deletes the comments left on its gone tasks, a guest’s included, and their history', async () => {
	const host = await signUp(app, 'Host');
	const me = host.person.id;
	const taskId = crypto.randomUUID();
	const mine = crypto.randomUUID();
	const theirs = crypto.randomUUID();
	const comment = (id: string, body: string) => ({
		op: 'put',
		table: 'comments',
		id,
		values: { id, user_id: me, task_id: taskId, body, created_at: 1, edited_at: null },
	});
	await upload(host, [{ op: 'put', table: 'tasks', id: taskId, values: taskRow(taskId, me, 'Shared') }]);
	await shareWith(app, host, { kind: 'task', id: taskId }, guest.person.id, 'edit');
	await upload(host, [comment(mine, 'Mine')]);
	await upload(guest, [comment(theirs, 'Theirs')]);

	const rejected = await uploadAs(app, host, [
		{ op: 'delete', table: 'comments', id: mine },
		{ op: 'delete', table: 'comments', id: theirs },
		{ op: 'delete', table: 'tasks', id: taskId },
	]);
	expect(rejected.map(r => r.id)).toEqual([theirs]);
	expect(await app.db.select().from(comments).where(eq(comments.userId, me))).toEqual([]);
	expect(await app.db.select().from(log).where(eq(log.userId, me))).toEqual([]);
});
