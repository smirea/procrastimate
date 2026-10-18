import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { access, comments, log, tasks } from '../../shared/db/schema';
import type { Person, ShareView, SpaceView } from '../../shared/sharing';
import { json, ORIGIN, signUp, taskRow, testApp, tokenHeaders, upload, type Session, type TestApp } from './test-app';

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
		const id = await newTask('Temporary');
		const view = await share({ kind: 'task', id }, guest, 'view');
		expect(await accessRows(guest.person.id)).toContain(`task:${id}:view`);
		expect((await call(owner, 'DELETE', `/api/shares?id=${view.id}`)).status).toBe(200);
		expect(await accessRows(guest.person.id)).not.toContain(`task:${id}:view`);
		const seen = await json<SpaceView>(call(guest, 'GET', `/api/view?space=${owner.person.id}`));
		expect(seen.tasks.map(task => task.id)).not.toContain(id);
	});

	test('a guest learns the owner’s name from the people route, with no query', async () => {
		const id = await newTask('Named');
		await share({ kind: 'task', id }, guest, 'view');
		const listed = await json<{ people: Person[] }>(call(guest, 'GET', '/api/people?q='));
		expect(listed.people.find(person => person.id === owner.person.id)?.name).toBe('Owner');
		const filtered = await json<{ people: Person[] }>(call(guest, 'GET', '/api/people?q=ow'));
		expect(filtered.people.map(person => person.id)).toEqual([owner.person.id]);
		const none = await json<{ people: Person[] }>(call(guest, 'GET', '/api/people?q=zz'));
		expect(none.people).toEqual([]);
	});

	test('a stranger is turned away from the space', async () => {
		const stranger = await signUp(app, 'Stranger');
		expect((await call(stranger, 'GET', `/api/view?space=${owner.person.id}`)).status).toBe(403);
	});

	test('a guest’s delete retried after its row went still lands in the owner’s log and access', async () => {
		const helper = await signUp(app, 'Helper');
		const id = await newTask('Return the drill');
		await share({ kind: 'task', id }, helper, 'edit');
		expect(await accessRows(helper.person.id)).toEqual([`task:${id}:edit`]);
		// The state a crash between the delete and its bookkeeping leaves: the row gone, nothing else changed.
		await app.db.delete(tasks).where(eq(tasks.id, id));
		const retry = [{ op: 'delete', table: 'tasks', id, opId: `${id}:delete` }];
		expect(await upload(app, helper, retry)).toEqual([]);
		const logged = await app.db
			.select({ owner: log.userId, actor: log.actor, op: log.op })
			.from(log)
			.where(and(eq(log.id, id), eq(log.op, 'delete')));
		expect(logged).toEqual([{ owner: owner.person.id, actor: helper.person.id, op: 'delete' }]);
		expect(await accessRows(helper.person.id)).toEqual([]);
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

describe('public links', () => {
	test('a link shows the target without signing in and stops working when deleted', async () => {
		const id = await newTask('Public');
		const link = await json<ShareView>(
			call(owner, 'POST', '/api/shares', { target: { kind: 'task', id }, audience: { kind: 'link' } }),
		);
		expect(link.url).toContain(`/s/${owner.person.id}.`);
		const token = link.url!.split('/s/')[1]!;
		const shown = await json<{ tasks: { id: string }[]; owner: Person }>(app.fetch(`/api/shared?token=${token}`));
		expect(shown.tasks.map(task => task.id)).toEqual([id]);
		expect(shown.owner.id).toBe(owner.person.id);
		expect((await call(owner, 'DELETE', `/api/shares?id=${link.id}`)).status).toBe(200);
		expect((await app.fetch(`/api/shared?token=${token}`)).status).toBe(404);
	});
});

describe('AI accounts', () => {
	test('an AI account acts in its owner’s whole space through a token and is gone with its account', async () => {
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Butler' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
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

	test('an AI account saves a place, resizes it, and puts tasks at it with @name', async () => {
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Mapper' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
		const headers = tokenHeaders(token);
		const asAi = (method: string, path: string, body?: unknown) =>
			app.fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
		const place = { address: null, latitude: 52.5, longitude: 13.4, radius: 80 };
		const label = await json<{ id: string; place: { radius: number } | null }>(
			asAi('POST', '/api/labels', { name: 'office', place }),
		);
		expect(label.place?.radius).toBe(80);
		const resized = await json<{ place: { radius: number } | null }>(
			asAi('PATCH', `/api/labels?id=${label.id}`, { radius: 150 }),
		);
		expect(resized.place?.radius).toBe(150);
		const task = await json<{ labelIds: string[]; location: { name: string } | null }>(
			asAi('POST', '/api/tasks', { text: 'Print the badges @office' }),
		);
		expect(task.labelIds).toEqual([]);
		expect(task.location?.name).toBe('office');
	});

	test('the agent API reports which app created each task and which wrote to it last', async () => {
		const id = await newTask('Clients');
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Editor' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
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
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Narrow' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
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
});

describe('people search', () => {
	test('an exact email finds anyone, a name prefix only people the caller knows, and never the caller', async () => {
		const email = `stranger-${crypto.randomUUID()}@procrastimate.test`;
		const signedUp = await app.fetch('/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: ORIGIN },
			body: JSON.stringify({ email, password: 'test-password-1', name: 'Stranger' }),
		});
		const { user: stranger } = (await signedUp.json()) as { user: { id: string } };
		const search = async (q: string) =>
			(await json<{ people: Person[] }>(call(owner, 'GET', `/api/people?q=${encodeURIComponent(q)}`))).people.map(
				person => person.name,
			);
		expect(await search(email.toUpperCase())).toEqual(['Stranger']);
		expect(await search('Stra')).toEqual([]);
		const known = await search('');
		expect(known).toContain('Guest');
		expect(known).toContain('Mapper');
		expect(known).not.toContain('Owner');
		expect(known).not.toContain('Stranger');
		expect(stranger.id).not.toBe(owner.person.id);
	});
});
