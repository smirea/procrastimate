import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { access, comments, log, tasks } from '../../shared/db/schema';
import type { Person, ShareView, SpaceView } from '../../shared/sharing';
import {
	aiAccount,
	json,
	ORIGIN,
	type Session,
	shareWith,
	signUp,
	taskRow,
	testApp,
	type TestApp,
	tokenHeaders,
	upload,
} from './test-app';

let app: TestApp;
let owner: Session;
let guest: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
	guest = await signUp(app, 'Guest');
});
afterAll(() => app.close());

const call = (session: Session, method: string, path: string, body?: unknown) =>
	app.fetch(path, { method, headers: session.headers, body: body === undefined ? undefined : JSON.stringify(body) });

const share = (target: { kind: string; id: string }, grantee: Session, role: 'view' | 'edit') =>
	json<ShareView>(
		call(owner, 'POST', '/api/shares', { target, audience: { kind: 'user', userId: grantee.person.id, role } }),
	);

const accessRows = async (grantee: string) =>
	(await app.db.select().from(access).where(eq(access.grantee, grantee)))
		.map(row => `${row.kind}:${row.entityId}:${row.role}`)
		.toSorted();

async function newTask(title: string, extra: Record<string, unknown> = {}): Promise<string> {
	const id = crypto.randomUUID();
	expect(
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, title, extra) }]),
	).toEqual([]);
	return id;
}

describe('sharing a task', () => {
	test('a view share lets the guest see the task and its subtasks, and the access table says so', async () => {
		const parent = await newTask('Plan the trip');
		const child = await newTask('Book flights', { parentId: parent });
		await newTask('Private');
		const view = await share({ kind: 'task', id: parent }, guest, 'view');
		expect(view.grantee?.id).toBe(guest.person.id);
		expect(await accessRows(guest.person.id)).toEqual([`task:${child}:view`, `task:${parent}:view`].toSorted());

		const seen = await json<SpaceView>(call(guest, 'GET', `/api/view?space=${owner.person.id}`));
		expect(seen.tasks.map(task => task.title).toSorted()).toEqual(['Book flights', 'Plan the trip']);
		expect(seen.readOnly.toSorted()).toEqual([child, parent].toSorted());

		const refused = await upload(app, guest, [
			{ op: 'patch', table: 'tasks', id: parent, values: { title: 'Mine now' } },
		]);
		expect(refused).toEqual([{ table: 'tasks', id: parent, reason: 'Not editable in this share' }]);
	});

	test('an edit share lets the guest edit, add subtasks it created, and comment, each stamped with the guest', async () => {
		const parent = await newTask('Groceries');
		await share({ kind: 'task', id: parent }, guest, 'edit');
		expect(
			await upload(app, guest, [
				{ op: 'patch', table: 'tasks', id: parent, values: { title: 'Groceries for Sunday' } },
			]),
		).toEqual([]);
		const sub = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{ op: 'put', table: 'tasks', id: sub, values: taskRow(sub, owner.person.id, 'Milk', { parentId: parent }) },
			]),
		).toEqual([]);
		const [row] = await app.db.select().from(tasks).where(eq(tasks.id, sub));
		expect(row).toMatchObject({ userId: owner.person.id, parentId: parent, createdBy: guest.person.id });
		expect(await accessRows(guest.person.id)).toContain(`task:${sub}:edit`);

		const comment = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{
					op: 'put',
					table: 'comments',
					id: comment,
					values: {
						id: comment,
						user_id: owner.person.id,
						task_id: parent,
						body: 'Got it',
						author_id: 'liar',
						created_at: 1,
						edited_at: null,
					},
				},
			]),
		).toEqual([]);
		const comments = await json<{ comments: { id: string; author: Person }[] }>(
			call(owner, 'GET', `/api/comments?id=${parent}`),
		);
		expect(comments.comments.find(c => c.id === comment)?.author.id).toBe(guest.person.id);
		expect(
			await upload(app, owner, [{ op: 'patch', table: 'comments', id: comment, values: { body: 'edited by owner' } }]),
		).toEqual([{ table: 'comments', id: comment, reason: 'Only the author can edit a comment' }]);
	});

	test('a guest may not graft a task onto the owner’s private tree or into an unshared project', async () => {
		const shared = await newTask('Shared');
		const hidden = await newTask('Hidden');
		await share({ kind: 'task', id: shared }, guest, 'edit');
		const id = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Graft', { parentId: hidden }) },
			]),
		).toEqual([{ table: 'tasks', id, reason: 'Not editable in this share' }]);
		const refused = await upload(app, guest, [
			{ op: 'patch', table: 'tasks', id: shared, values: { project_id: crypto.randomUUID() } },
			{ op: 'patch', table: 'tasks', id: shared, values: { source_key: 'todoist:task:1' } },
			{ op: 'delete', table: 'tasks', id: hidden },
		]);
		expect(refused.map(entry => entry.reason)).toEqual(['Not editable in this share', 'Not editable in this share']);
		expect((await app.db.select().from(tasks).where(eq(tasks.id, hidden))).length).toBe(1);
	});

	test('a guest cannot clear the project or parent of the owner’s task', async () => {
		const project = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'projects',
				id: project,
				values: { id: project, user_id: owner.person.id, name: 'Yard', order: 0, created_at: 1 },
			},
		]);
		const parent = await newTask('Mow', { projectId: project });
		const child = await newTask('Fuel', { projectId: project, parentId: parent });
		await share({ kind: 'project', id: project }, guest, 'edit');
		const reason = 'A guest cannot take a task out of its project or parent';
		expect(
			await upload(app, guest, [
				{ op: 'patch', table: 'tasks', id: parent, values: { project_id: null } },
				{ op: 'patch', table: 'tasks', id: child, values: { parent_id: null } },
			]),
		).toEqual([
			{ table: 'tasks', id: parent, reason },
			{ table: 'tasks', id: child, reason },
		]);
		expect(await upload(app, guest, [{ op: 'patch', table: 'tasks', id: child, values: { title: 'Petrol' } }])).toEqual(
			[],
		);
		const rows = await app.db
			.select()
			.from(tasks)
			.where(inArray(tasks.id, [parent, child]));
		expect(rows.map(row => [row.title, row.projectId, row.parentId]).toSorted()).toEqual([
			['Mow', project, null],
			['Petrol', project, parent],
		]);
	});

	test('a guest cannot rewrite or move a task it holds no edit row for, whatever id it knows', async () => {
		const project = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'projects',
				id: project,
				values: { id: project, user_id: owner.person.id, name: 'Garden', order: 0, created_at: 1 },
			},
		]);
		const hidden = await newTask('Private diary');
		await share({ kind: 'project', id: project }, guest, 'edit');
		const refused = { table: 'tasks', id: hidden, reason: 'Not editable in this share' };
		expect(
			await upload(app, guest, [
				{ op: 'patch', table: 'tasks', id: hidden, values: { project_id: project, title: 'Overwritten' } },
			]),
		).toEqual([refused]);
		expect(
			await upload(app, guest, [
				{
					op: 'put',
					table: 'tasks',
					id: hidden,
					values: taskRow(hidden, owner.person.id, 'Put by guest', { projectId: project }),
				},
			]),
		).toEqual([refused]);
		const [row] = await app.db.select().from(tasks).where(eq(tasks.id, hidden));
		expect([row!.title, row!.projectId]).toEqual(['Private diary', null]);
	});

	test('a guest’s own comment on a task downgraded to view cannot be rewritten by a put naming another task', async () => {
		const first = await newTask('First');
		const second = await newTask('Second');
		await share({ kind: 'task', id: first }, guest, 'edit');
		await share({ kind: 'task', id: second }, guest, 'edit');
		const id = crypto.randomUUID();
		const row = (taskId: string, body: string) => ({
			id,
			user_id: owner.person.id,
			task_id: taskId,
			body,
			created_at: 1,
		});
		expect(await upload(app, guest, [{ op: 'put', table: 'comments', id, values: row(first, 'hello') }])).toEqual([]);
		await share({ kind: 'task', id: first }, guest, 'view');
		expect(await upload(app, guest, [{ op: 'put', table: 'comments', id, values: row(second, 'moved') }])).toEqual([
			{ table: 'comments', id, reason: 'Not editable in this share' },
		]);
		const [stored] = await app.db.select().from(comments).where(eq(comments.id, id));
		expect([stored!.body, stored!.taskId]).toEqual(['hello', first]);
	});

	test('a guest’s batch admits a subtask’s own subtask and comment in the same batch', async () => {
		const parent = await newTask('Parent');
		await share({ kind: 'task', id: parent }, guest, 'edit');
		const sub = crypto.randomUUID();
		const subSub = crypto.randomUUID();
		const comment = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{ op: 'put', table: 'tasks', id: sub, values: taskRow(sub, owner.person.id, 'Sub', { parentId: parent }) },
				{
					op: 'put',
					table: 'tasks',
					id: subSub,
					values: taskRow(subSub, owner.person.id, 'Sub sub', { parentId: sub }),
				},
				{
					op: 'put',
					table: 'comments',
					id: comment,
					values: { id: comment, user_id: owner.person.id, task_id: sub, body: 'hi', created_at: 1 },
				},
			]),
		).toEqual([]);
		expect(await accessRows(guest.person.id)).toContain(`task:${subSub}:edit`);
	});

	test('a guest’s undo of deleting an imported task restores it without its import key', async () => {
		const project = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'projects',
				id: project,
				values: { id: project, user_id: owner.person.id, name: 'Imported', order: 0, created_at: 1 },
			},
		]);
		const id = await newTask('From Todoist', { projectId: project, sourceKey: 'todoist:task:1' });
		await share({ kind: 'project', id: project }, guest, 'edit');
		expect(await upload(app, guest, [{ op: 'delete', table: 'tasks', id }])).toEqual([]);
		const restored = taskRow(id, owner.person.id, 'From Todoist', { projectId: project, sourceKey: 'todoist:task:1' });
		expect(await upload(app, guest, [{ op: 'put', table: 'tasks', id, values: restored }])).toEqual([]);
		const [row] = await app.db.select().from(tasks).where(eq(tasks.id, id));
		expect([row!.title, row!.sourceKey]).toEqual(['From Todoist', null]);
		const kept = await newTask('Keeps its key', { projectId: project, sourceKey: 'todoist:task:2' });
		expect(
			await upload(app, guest, [
				{
					op: 'put',
					table: 'tasks',
					id: kept,
					values: taskRow(kept, owner.person.id, 'Keeps its key', { projectId: project }),
				},
			]),
		).toEqual([]);
		expect((await app.db.select().from(tasks).where(eq(tasks.id, kept)))[0]!.sourceKey).toBe('todoist:task:2');
	});

	test('an agent command a guest may only partly do is refused whole', async () => {
		const parent = await newTask('Parent');
		const child = await newTask('Child', { parentId: parent });
		await share({ kind: 'task', id: parent }, guest, 'view');
		await share({ kind: 'task', id: child }, guest, 'edit');
		const response = await call(guest, 'DELETE', `/api/tasks?space=${owner.person.id}&id=${parent}`);
		expect(response.status).toBe(403);
		const left = await app.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, child));
		expect(left.length).toBe(1);
	});

	test('a guest’s re-put of the owner’s task keeps created_by, and a view-only guest cannot comment', async () => {
		const id = await newTask('Keep the author');
		await share({ kind: 'task', id }, guest, 'edit');
		expect(
			await upload(app, guest, [
				{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Re-put by the guest') },
			]),
		).toEqual([]);
		const [row] = await app.db.select().from(tasks).where(eq(tasks.id, id));
		expect(row).toMatchObject({ title: 'Re-put by the guest', createdBy: owner.person.id });

		const viewed = await newTask('Read only');
		await share({ kind: 'task', id: viewed }, guest, 'view');
		const comment = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{
					op: 'put',
					table: 'comments',
					id: comment,
					values: { id: comment, user_id: owner.person.id, task_id: viewed, body: 'psst', created_at: 1 },
				},
			]),
		).toEqual([{ table: 'comments', id: comment, reason: 'Not editable in this share' }]);
		expect(await app.db.select().from(comments).where(eq(comments.id, comment))).toEqual([]);
	});

	test('a guest deletes only its own comment, and the owner’s stays', async () => {
		const id = await newTask('Talk');
		await share({ kind: 'task', id }, guest, 'edit');
		const theirs = crypto.randomUUID();
		const mine = crypto.randomUUID();
		const row = (commentId: string, body: string) => ({
			id: commentId,
			user_id: owner.person.id,
			task_id: id,
			body,
			created_at: 1,
		});
		expect(
			await upload(app, owner, [{ op: 'put', table: 'comments', id: theirs, values: row(theirs, 'owner') }]),
		).toEqual([]);
		expect(await upload(app, guest, [{ op: 'put', table: 'comments', id: mine, values: row(mine, 'guest') }])).toEqual(
			[],
		);
		expect(
			await upload(app, guest, [
				{ op: 'delete', table: 'comments', id: theirs },
				{ op: 'delete', table: 'comments', id: mine },
			]),
		).toEqual([{ table: 'comments', id: theirs, reason: 'Only the author can delete a comment' }]);
		expect((await app.db.select().from(comments).where(eq(comments.taskId, id))).map(c => c.id)).toEqual([theirs]);
	});

	test('revoking the share removes the access rows, and the guest sees nothing', async () => {
		// A second share keeps the space readable, so the view below shows the revoked task gone rather than a 403.
		const kept = await newTask('Kept');
		await share({ kind: 'task', id: kept }, guest, 'view');
		const id = await newTask('Temporary');
		const view = await share({ kind: 'task', id }, guest, 'view');
		expect(await accessRows(guest.person.id)).toContain(`task:${id}:view`);
		expect((await call(owner, 'DELETE', `/api/shares?id=${view.id}`)).status).toBe(200);
		expect(await accessRows(guest.person.id)).not.toContain(`task:${id}:view`);
		const seen = await json<SpaceView>(call(guest, 'GET', `/api/view?space=${owner.person.id}`));
		expect(seen.tasks.map(task => task.id)).toContain(kept);
		expect(seen.tasks.map(task => task.id)).not.toContain(id);
	});

	test('a guest names whoever made or finished a task it sees, and nobody acting only elsewhere', async () => {
		const coGuest = await signUp(app, 'Coguest');
		const elsewhere = await signUp(app, 'Elsewhere');
		const id = await newTask('Party');
		const other = await newTask('Unrelated');
		await share({ kind: 'task', id }, guest, 'view');
		const coShare = await share({ kind: 'task', id }, coGuest, 'edit');
		await share({ kind: 'task', id: other }, elsewhere, 'edit');
		const sub = crypto.randomUUID();
		const hidden = crypto.randomUUID();
		expect(
			await upload(app, coGuest, [
				{ op: 'put', table: 'tasks', id: sub, values: taskRow(sub, owner.person.id, 'Cake', { parentId: id }) },
			]),
		).toEqual([]);
		expect(
			await upload(app, elsewhere, [
				{
					op: 'put',
					table: 'tasks',
					id: hidden,
					values: taskRow(hidden, owner.person.id, 'Hidden', { parentId: other }),
				},
				{ op: 'patch', table: 'tasks', id: other, values: { completedAt: 1 } },
			]),
		).toEqual([]);
		const names = async (session: Session) =>
			(await json<{ people: Person[] }>(call(session, 'GET', '/api/people?q='))).people.map(person => person.name);
		expect(await names(guest)).toContain('Coguest');
		expect(await names(guest)).not.toContain('Elsewhere');
		expect(await json<{ people: Person[] }>(call(guest, 'GET', '/api/people?q=co'))).toEqual({
			people: [{ id: coGuest.person.id, name: 'Coguest', kind: 'human', ownerId: null }],
		});

		expect((await call(owner, 'DELETE', `/api/shares?id=${coShare.id}`)).status).toBe(200);
		expect(await names(owner)).toContain('Coguest');
	});

	test('a guest’s delete that fully landed, retried, logs nothing more in either space', async () => {
		const helper = await signUp(app, 'Helper');
		const id = await newTask('Lend the ladder');
		await share({ kind: 'task', id }, helper, 'edit');
		const remove = [{ op: 'delete', table: 'tasks', id, opId: `${id}:delete` }];
		expect(await upload(app, helper, remove)).toEqual([]);
		expect(await accessRows(helper.person.id)).toEqual([]);
		expect(await upload(app, helper, remove)).toEqual([]);
		const logged = await app.db
			.select({ owner: log.userId, actor: log.actor, op: log.op })
			.from(log)
			.where(eq(log.id, id))
			.orderBy(log.seq);
		expect(logged).toEqual([
			{ owner: owner.person.id, actor: owner.person.id, op: 'put' },
			{ owner: owner.person.id, actor: helper.person.id, op: 'delete' },
		]);
	});
});

describe('sharing a list', () => {
	test('a project’s, section’s, or label’s access row says edit exactly where the guest may add a task', async () => {
		const garden = crypto.randomUUID();
		const beds = crypto.randomUUID();
		const weekend = crypto.randomUUID();
		const shed = crypto.randomUUID();
		const me = owner.person.id;
		expect(
			await upload(app, owner, [
				{
					op: 'put',
					table: 'projects',
					id: garden,
					values: { id: garden, user_id: me, name: 'Garden', created_at: 1 },
				},
				{ op: 'put', table: 'projects', id: shed, values: { id: shed, user_id: me, name: 'Shed', created_at: 2 } },
				{
					op: 'put',
					table: 'sections',
					id: beds,
					values: { id: beds, user_id: me, project_id: garden, name: 'Beds', created_at: 1 },
				},
				{
					op: 'put',
					table: 'labels',
					id: weekend,
					values: { id: weekend, user_id: me, name: 'Weekend', created_at: 1 },
				},
			]),
		).toEqual([]);
		const tulips = await newTask('Plant tulips', {
			projectId: garden,
			sectionId: beds,
			labelIds: JSON.stringify([weekend]),
		});
		const hinges = await newTask('Oil the hinges', { projectId: shed });
		await share({ kind: 'project', id: garden }, guest, 'edit');
		await share({ kind: 'project', id: shed }, guest, 'view');

		const rows = await accessRows(guest.person.id);
		expect(rows).toContain(`project:${garden}:edit`);
		expect(rows).toContain(`section:${beds}:edit`);
		expect(rows).toContain(`task:${tulips}:edit`);
		expect(rows).toContain(`project:${shed}:view`);
		expect(rows).toContain(`task:${hinges}:view`);
		expect(rows).toContain(`label:${weekend}:view`);

		const watered = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{
					op: 'put',
					table: 'tasks',
					id: watered,
					values: taskRow(watered, me, 'Water', { projectId: garden, sectionId: beds }),
				},
			]),
		).toEqual([]);
		const swept = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{ op: 'put', table: 'tasks', id: swept, values: taskRow(swept, me, 'Sweep', { projectId: shed }) },
			]),
		).toEqual([{ table: 'tasks', id: swept, reason: 'Not editable in this share' }]);

		await share({ kind: 'label', id: weekend }, guest, 'edit');
		expect(await accessRows(guest.person.id)).toContain(`label:${weekend}:edit`);
		const labelled = crypto.randomUUID();
		expect(
			await upload(app, guest, [
				{
					op: 'put',
					table: 'tasks',
					id: labelled,
					values: taskRow(labelled, me, 'Rake', { labelIds: JSON.stringify([weekend]) }),
				},
			]),
		).toEqual([]);
		expect(await accessRows(guest.person.id)).toContain(`task:${labelled}:edit`);

		// Moving the task out of every shared place leaves the guest's view: the access rows follow the move.
		expect(
			await upload(app, owner, [{ op: 'patch', table: 'tasks', id: labelled, values: { label_ids: '[]' } }]),
		).toEqual([]);
		expect(await accessRows(guest.person.id)).not.toContain(`task:${labelled}:edit`);
	});

	test('deleting a shared project or label takes away what its share reached, and restoring it gives it back', async () => {
		const lister = await signUp(app, 'Lister');
		const me = owner.person.id;
		const [porch, rainy] = [crypto.randomUUID(), crypto.randomUUID()];
		const porchRow = { id: porch, user_id: me, name: 'Porch', created_at: 1 };
		const rainyRow = { id: rainy, user_id: me, name: 'Rainy', created_at: 1 };
		expect(
			await upload(app, owner, [
				{ op: 'put', table: 'projects', id: porch, values: porchRow },
				{ op: 'put', table: 'labels', id: rainy, values: rainyRow },
			]),
		).toEqual([]);
		const paint = await newTask('Paint the porch', { projectId: porch });
		const mop = await newTask('Mop', { labelIds: JSON.stringify([rainy]) });
		const guestRows = await accessRows(guest.person.id);
		await share({ kind: 'project', id: porch }, lister, 'view');
		await share({ kind: 'label', id: rainy }, lister, 'view');
		const shared = [`label:${rainy}:view`, `project:${porch}:view`, `task:${mop}:view`, `task:${paint}:view`];
		expect(await accessRows(lister.person.id)).toEqual(shared.toSorted());
		expect(await accessRows(guest.person.id)).toEqual(guestRows);

		expect(
			await upload(app, owner, [
				{ op: 'delete', table: 'projects', id: porch },
				{ op: 'delete', table: 'labels', id: rainy },
			]),
		).toEqual([]);
		expect(await accessRows(lister.person.id)).toEqual([]);

		expect(
			await upload(app, owner, [
				{ op: 'put', table: 'projects', id: porch, values: porchRow },
				{ op: 'put', table: 'labels', id: rainy, values: rainyRow },
			]),
		).toEqual([]);
		expect(await accessRows(lister.person.id)).toEqual(shared.toSorted());
	});
});

describe('public links', () => {});

describe('AI accounts', () => {
	test('an AI account acts in its owner’s whole space through a token and is gone with its account', async () => {
		const { person: ai, token } = await aiAccount(app, owner, 'Butler');
		const headers = tokenHeaders(token);
		const me = await app.fetch('/api/me', { headers });
		expect(me.status).toBe(403);
		const created = await json<{ id: string; createdBy: string }>(
			app.fetch('/api/tasks', { method: 'POST', headers, body: JSON.stringify({ title: 'From the butler' }) }),
		);
		expect(created.createdBy).toBe(ai.id);
		const [row] = await app.db.select().from(tasks).where(eq(tasks.id, created.id));
		expect(row?.userId).toBe(owner.person.id);
		expect(await accessRows(ai.id)).toEqual([]);

		expect((await call(owner, 'DELETE', `/api/ai?id=${ai.id}`)).status).toBe(200);
		expect((await app.fetch('/api/view', { headers })).status).toBe(401);
	});

	test('the agent API refuses a date or a repeat beside an event, which stands in for both', async () => {
		const { token } = await aiAccount(app, owner, 'Planner');
		const headers = tokenHeaders(token);
		const asAi = (method: string, path: string, body?: unknown) =>
			app.fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
		const task = await json<{ id: string }>(asAi('POST', '/api/tasks', { text: 'Prepare the standup notes' }));
		const occurrence = {
			start: Date.UTC(2026, 9, 20, 9),
			end: Date.UTC(2026, 9, 20, 10),
			original: Date.UTC(2026, 9, 20, 9),
		};
		const event = {
			id: 'standup',
			title: 'Standup',
			allDay: false,
			series: false,
			edge: 'start',
			minutes: 0,
			occurrences: [occurrence],
		};
		const together = await asAi('PATCH', `/api/tasks?id=${task.id}`, {
			event,
			recurrence: { interval: 1, unit: 'day' },
		});
		expect(together.status).toBe(400);
		const linked = await json<{ event: { id: string } | null }>(asAi('PATCH', `/api/tasks?id=${task.id}`, { event }));
		expect(linked.event?.id).toBe('standup');
		const beforeEnd = { ...event, edge: 'beforeEnd', minutes: 1440 };
		const anchored = await json<{ event: unknown }>(asAi('PATCH', `/api/tasks?id=${task.id}`, { event: beforeEnd }));
		expect(anchored.event).toEqual(beforeEnd);
		const dated = await asAi('PATCH', `/api/tasks?id=${task.id}`, { due: { date: '2026-10-20', time: null } });
		expect(await dated.json()).toMatchObject({ message: 'An event stands in for the date and the repeat' });
	});

	test('the agent API reports which app created each task and which wrote to it last', async () => {
		const id = await newTask('Clients');
		const { token } = await aiAccount(app, owner, 'Editor');
		const headers = { ...tokenHeaders(token), 'user-agent': 'curl/8.1' };
		await app.fetch(`/api/tasks?id=${id}`, {
			method: 'PATCH',
			headers,
			body: JSON.stringify({ title: 'Clients, edited' }),
		});
		const view = await json<SpaceView>(app.fetch('/api/view', { headers }));
		const task = view.tasks.find(t => t.id === id)!;
		expect(task.clients.created).toMatchObject({ kind: 'web', device: 'test' });
		expect(task.clients.edited).toMatchObject({ kind: 'api', device: 'curl/8.1' });
	});

	test('an AI account with only a task shared sees that task and its activity, and nothing else', async () => {
		const shown = await newTask('For the bot');
		const hidden = await newTask('Not for the bot');
		const { person: ai, token } = await aiAccount(app, owner, 'Narrow');
		const { shares } = await json<{ shares: ShareView[] }>(call(owner, 'GET', '/api/shares'));
		const whole = shares.find(s => s.grantee?.id === ai.id && s.target.kind === 'space')!;
		expect((await call(owner, 'DELETE', `/api/shares?id=${whole.id}`)).status).toBe(200);
		await json<ShareView>(
			call(owner, 'POST', '/api/shares', {
				target: { kind: 'task', id: shown },
				audience: { kind: 'user', userId: ai.id, role: 'view' },
			}),
		);
		const headers = tokenHeaders(token);
		const view = await json<SpaceView>(app.fetch('/api/view', { headers }));
		expect(view.tasks.map(task => task.id)).toEqual([shown]);
		expect((await app.fetch(`/api/activity?id=${shown}`, { headers })).status).toBe(200);
		expect((await app.fetch(`/api/activity?id=${hidden}`, { headers })).status).toBe(404);
		expect((await app.fetch(`/api/comments?id=${hidden}`, { headers })).status).toBe(404);
	});

	test('an AI account checks access like a person: rows for a narrowed share, none as the whole space’s manager', async () => {
		const project = crypto.randomUUID();
		expect(
			await upload(app, owner, [
				{
					op: 'put',
					table: 'projects',
					id: project,
					values: { id: project, user_id: owner.person.id, name: 'Errands', created_at: 1 },
				},
			]),
		).toEqual([]);
		const inside = await newTask('Buy stamps', { projectId: project });
		const outside = await newTask('Not the bot’s');
		const { person: ai, headers } = await aiAccount(app, owner, 'Errand bot');
		expect(await accessRows(ai.id)).toEqual([]);
		const { shares } = await json<{ shares: ShareView[] }>(call(owner, 'GET', '/api/shares'));
		const whole = shares.find(s => s.grantee?.id === ai.id && s.target.kind === 'space')!;
		await call(owner, 'DELETE', `/api/shares?id=${whole.id}`);
		await shareWith(app, owner, { kind: 'project', id: project }, ai.id, 'edit');
		expect(await accessRows(ai.id)).toEqual([`project:${project}:edit`, `task:${inside}:edit`]);
		const edit = (id: string) =>
			app.fetch(`/api/tasks?id=${id}&space=${owner.person.id}`, {
				method: 'PATCH',
				headers,
				body: JSON.stringify({ title: 'Edited by the bot' }),
			});
		expect((await edit(inside)).status).toBe(200);
		expect((await edit(outside)).status).toBe(404);
		const [row] = await app.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, inside));
		expect(row).toEqual({ title: 'Edited by the bot' });
		expect((await call(owner, 'DELETE', `/api/ai?id=${ai.id}`)).status).toBe(200);
		expect(await accessRows(ai.id)).toEqual([]);
	});
});

describe('people search', () => {
	test('an exact email finds anyone, a name prefix only people the caller knows, and never the caller', async () => {
		const email = `stranger-${crypto.randomUUID()}@procrastimate.test`;
		const signedUp = await app.fetch('/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: ORIGIN },
			body: JSON.stringify({ email, password: 'test-password-1', name: 'Stranger' }),
		});
		expect(signedUp.status).toBe(200);
		await aiAccount(app, owner, 'Scout');
		await share({ kind: 'task', id: await newTask('Known') }, guest, 'view');
		const search = async (q: string) =>
			(await json<{ people: Person[] }>(call(owner, 'GET', `/api/people?q=${encodeURIComponent(q)}`))).people.map(
				person => person.name,
			);
		expect(await search(email.toUpperCase())).toEqual(['Stranger']);
		expect(await search('Stra')).toEqual([]);
		const known = await search('');
		expect(known).toContain('Guest');
		expect(known).toContain('Scout');
		expect(known).not.toContain('Owner');
		expect(known).not.toContain('Stranger');
	});
});
