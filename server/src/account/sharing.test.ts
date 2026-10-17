import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { CLIENT_HEADER } from '../../../shared/auth';
import type {
	ActivityEntry,
	AgentTask,
	Person,
	ShareView,
	SharedView,
	Space,
	SpaceView,
	TaskComment,
} from '../../../shared/sharing';
import { projectsInOrder } from '../../../shared/store';
import { formatHlc } from '../../../shared/sync/hlc';
import {
	DEFAULT_SETTINGS,
	type Label,
	type Op,
	type Snapshot,
	type SyncResponse,
	type Task,
} from '../../../shared/sync/protocol';
import { fieldsOf } from '../../../shared/sync/snapshot';
import { label, project, section, task } from '../../../shared/sync/testing';
import api from '../api';
import type { Env } from '../bindings';
import { memoryAccount } from './account';
import { authHeaders, registerDevice, whoAmI, type DeviceCredentials } from './test-device';

const NOW = Date.UTC(2026, 9, 14, 18);

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

type User = { cred: DeviceCredentials; env: Env; me: Person };
type Ok = { ok: true };
type Spaces = { spaces: Space[] };

/** Calls to other spaces run after the request's queue slot, so the test lets the event loop drain. */
const settled = () => new Promise(resolve => setTimeout(resolve, 20));

describe('sharing between two users', () => {
	let owner: User;
	let guest: User;
	let hlc = 0;

	/** `holdSlot` keeps each request in its space's serial queue a while, so two spaces are busy at once. */
	async function setUp(holdSlot = 0) {
		const account = memoryAccount(undefined, () => new Promise(resolve => setTimeout(resolve, holdSlot)));
		const ownerEnv: Env = { ACCOUNT: account, EPHEMERAL: '1' };
		const guestEnv: Env = { ACCOUNT: account, EPHEMERAL: '1' };
		const ownerCred = await registerDevice(ownerEnv, 'Owner Mac');
		const guestCred = await registerDevice(guestEnv, 'Guest Phone');
		owner = { cred: ownerCred, env: ownerEnv, me: await whoAmI(ownerEnv, ownerCred) };
		guest = { cred: guestCred, env: guestEnv, me: await whoAmI(guestEnv, guestCred) };
	}

	beforeEach(() => setUp());

	const call = (
		user: User | null,
		method: string,
		path: string,
		body?: unknown,
		headers: Record<string, string> = {},
	) =>
		api.fetch(
			new Request(`https://procrastimate.test${path}`, {
				method,
				headers: { 'content-type': 'application/json', ...(user ? authHeaders(user.cred) : {}), ...headers },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
			owner.env,
		);

	async function json<T = object>(pending: Response | Promise<Response>): Promise<T> {
		const response = await pending;
		if (response.status !== 200) throw new Error(`${response.status} ${await response.text()}`);
		return (await response.json()) as T;
	}

	const op = (user: User, id: string, fields: Op['fields'], kind: Op['kind'] = 'task'): Op =>
		({
			opId: `${user.me.name}-${++hlc}`,
			hlc: formatHlc({ wall: NOW + hlc, counter: 0, node: user.cred.deviceId }),
			kind,
			id,
			fields,
		}) as Op;
	const create = (user: User, created: Task) =>
		op(user, created.id, { deleted: false, ...fieldsOf('task', created) } as Op['fields']);

	const sync = (user: User, ops: Op[] = [], space?: string, extra: Record<string, unknown> = {}) =>
		call(user, 'POST', `/api/sync${space ? `?space=${space}` : ''}`, { cursor: 0, ops, ...extra });

	const snapshotOf = async (response: Promise<Response>) =>
		(await json<Extract<SyncResponse, { snapshot: unknown }>>(response)).snapshot;

	/** The owner's space: project Home with two tasks, one with a subtask, and an Inbox task with a label. */
	async function seedOwner() {
		await json(
			sync(owner, [
				{ ...op(owner, 'home', { deleted: false, name: 'Home', createdAt: NOW, sourceKey: null }, 'project') },
				{ ...op(owner, 'urgent', { deleted: false, name: 'Urgent', createdAt: NOW }, 'label') },
				create(owner, task('fix-sink', { title: 'Fix the sink', projectId: 'home', createdAt: NOW + 1 })),
				create(
					owner,
					task('buy-washer', { title: 'Buy a washer', projectId: 'home', parentId: 'fix-sink', createdAt: NOW + 2 }),
				),
				create(
					owner,
					task('paint', {
						title: 'Paint the fence',
						projectId: 'home',
						createdAt: NOW + 3,
						recurrence: { interval: 1, unit: 'week' },
						due: { date: '2026-10-19', time: null },
					}),
				),
				create(owner, task('taxes', { title: 'Do taxes', labelIds: ['urgent'], createdAt: NOW + 4 })),
			]),
		);
	}

	const share = (target: ShareView['target'], audience: unknown) =>
		json<ShareView>(call(owner, 'POST', '/api/shares', { target, audience }));

	const userShare = (role: 'view' | 'edit' = 'edit') =>
		share({ kind: 'project', id: 'home' }, { kind: 'user', userId: guest.me.id, role });

	test('the guest sees only the shared project, completes a task, and the owner sees who did it', async () => {
		await seedOwner();
		const created = await userShare();
		expect(created).toEqual({
			id: created.id,
			target: { kind: 'project', id: 'home' },
			grantee: { id: guest.me.id, name: 'Test', kind: 'human', ownerId: null },
			role: 'edit',
			createdAt: NOW,
			url: null,
		});
		await settled();
		expect(await json<Spaces>(call(guest, 'GET', '/api/spaces'))).toEqual({
			spaces: [{ id: owner.me.id, owner: { id: owner.me.id, name: 'Test', kind: 'human', ownerId: null } }],
		});

		const first = await json<SyncResponse>(sync(guest, [], owner.me.id));
		expect('snapshot' in first && first.snapshot.tasks.map(t => t.id)).toEqual(['fix-sink', 'buy-washer', 'paint']);
		expect('snapshot' in first && first.snapshot.projects.map(p => p.name)).toEqual(['Home']);
		expect('snapshot' in first && first.snapshot.labels).toEqual([]);
		expect('readOnly' in first && first.readOnly).toEqual([]);
		expect(first.scope).toBeString();

		const again = await json<SyncResponse>(sync(guest, [], owner.me.id, { scope: first.scope }));
		expect(again).toEqual({
			acked: [],
			rejected: [],
			changes: [],
			cursor: first.cursor,
			hlc: first.hlc,
			epoch: 0,
			scope: first.scope,
		});

		const done = await json<SyncResponse>(
			sync(
				guest,
				[
					op(guest, 'fix-sink', { completedAt: NOW + 10, lastCompletedAt: NOW + 10 }),
					op(guest, 'buy-washer', { completedAt: NOW + 10 }),
				],
				owner.me.id,
				{ scope: first.scope },
			),
		);
		expect(done.acked).toEqual([`Test-${hlc - 1}`, `Test-${hlc}`]);
		expect('snapshot' in done && done.snapshot.tasks.find(t => t.id === 'fix-sink')).toMatchObject({
			completedAt: NOW + 10,
			completedBy: guest.me.id,
		});

		const ownersView = await snapshotOf(sync(owner));
		expect(ownersView.tasks.map(t => [t.id, t.completedAt, t.completedBy])).toEqual([
			['fix-sink', NOW + 10, guest.me.id],
			['buy-washer', NOW + 10, guest.me.id],
			['paint', null, null],
			['taxes', null, null],
		]);
		expect(ownersView.tasks.map(t => t.createdBy)).toEqual(Array(4).fill(owner.me.id));

		const { entries } = await json<{ entries: ActivityEntry[] }>(call(owner, 'GET', '/api/activity?id=fix-sink'));
		expect(entries).toEqual([
			{
				at: NOW,
				actor: { id: owner.me.id, name: 'Test', kind: 'human', ownerId: null },
				action: 'created',
				summary: 'added this task',
			},
			{
				at: NOW,
				actor: { id: guest.me.id, name: 'Test', kind: 'human', ownerId: null },
				action: 'completed',
				summary: 'completed it',
			},
		]);
	});

	test('an edit outside the share is acked but never written', async () => {
		await seedOwner();
		await userShare();
		const refused = await json<SyncResponse>(
			sync(
				guest,
				[
					op(guest, 'taxes', { title: 'Hacked' }),
					create(guest, task('sneak', { title: 'Sneaked into Inbox', createdAt: NOW + 20 })),
					op(guest, 'home', { name: 'Renamed' }, 'project'),
				],
				owner.me.id,
			),
		);
		expect(refused.acked).toEqual([`Test-${hlc - 2}`, `Test-${hlc - 1}`, `Test-${hlc}`]);
		const ownersView = await snapshotOf(sync(owner));
		expect(ownersView.tasks.map(t => t.title)).toEqual(['Fix the sink', 'Buy a washer', 'Paint the fence', 'Do taxes']);
		expect(ownersView.projects.map(p => p.name)).toEqual(['Home']);

		const added = await json<SyncResponse>(
			sync(
				guest,
				[create(guest, task('extra', { title: 'Added by guest', projectId: 'home', createdAt: NOW + 21 }))],
				owner.me.id,
			),
		);
		expect('snapshot' in added && added.snapshot.tasks.find(t => t.id === 'extra')).toMatchObject({
			title: 'Added by guest',
			createdBy: guest.me.id,
		});
	});

	test('a view share shows the tasks read only and refuses writes', async () => {
		await seedOwner();
		await userShare('view');
		const response = await json<SyncResponse>(
			sync(guest, [op(guest, 'fix-sink', { completedAt: NOW + 10, lastCompletedAt: NOW + 10 })], owner.me.id),
		);
		expect('readOnly' in response && response.readOnly).toEqual(['fix-sink', 'buy-washer', 'paint']);
		expect('snapshot' in response && response.snapshot.tasks.find(t => t.id === 'fix-sink')?.completedAt).toBeNull();
		expect((await call(guest, 'POST', `/api/tasks/complete?space=${owner.me.id}&id=fix-sink`)).status).toBe(403);
	});

	const comment = (user: User, id: string, taskId: string, body: string, authorId: string | null = null) =>
		op(user, id, { deleted: false, taskId, body, authorId, createdAt: NOW + 50, editedAt: null }, 'comment');

	test('comments follow their task, carry the server’s author stamp, and only the author changes one', async () => {
		await seedOwner();
		await userShare();
		await json(
			sync(owner, [
				comment(owner, 'c-owner', 'fix-sink', 'Use the blue washer'),
				comment(owner, 'c-hidden', 'taxes', 'Private'),
			]),
		);
		const seen = await snapshotOf(sync(guest, [], owner.me.id));
		expect(seen.comments.map(c => [c.id, c.authorId])).toEqual([['c-owner', owner.me.id]]);
		expect(seen.reads).toEqual([]);

		await json(
			sync(
				guest,
				[
					comment(guest, 'c-guest', 'fix-sink', 'On it', owner.me.id),
					op(guest, 'c-owner', { body: 'Hijacked' }, 'comment'),
					comment(guest, 'c-sneak', 'taxes', 'Sneaked'),
					op(guest, 'fix-sink', { deleted: false, readAt: NOW }, 'read'),
				],
				owner.me.id,
			),
		);
		await json(sync(owner, [op(owner, 'c-guest', { body: 'Owner rewrote it' }, 'comment')]));
		const ownersView = await snapshotOf(sync(owner));
		expect(ownersView.comments.map(c => [c.id, c.body, c.authorId])).toEqual([
			['c-guest', 'On it', guest.me.id],
			['c-hidden', 'Private', owner.me.id],
			['c-owner', 'Use the blue washer', owner.me.id],
		]);
		expect(ownersView.reads).toEqual([]);

		const { entries } = await json<{ entries: ActivityEntry[] }>(call(owner, 'GET', '/api/activity?id=fix-sink'));
		expect(entries.map(e => [e.action, e.actor.id])).toEqual([
			['created', owner.me.id],
			['commented', owner.me.id],
			['commented', guest.me.id],
		]);
	});

	test('a view guest reads the comments but cannot write one', async () => {
		await seedOwner();
		await userShare('view');
		await json(sync(owner, [comment(owner, 'c-owner', 'fix-sink', 'Use the blue washer')]));
		const response = await snapshotOf(sync(guest, [comment(guest, 'c-guest', 'fix-sink', 'Me too')], owner.me.id));
		expect(response.comments.map(c => c.id)).toEqual(['c-owner']);
		const posted = await call(guest, 'POST', `/api/comments?space=${owner.me.id}`, { taskId: 'fix-sink', body: 'Hi' });
		expect(posted.status).toBe(403);
		const listed = await json<{ comments: { id: string }[] }>(
			call(guest, 'GET', `/api/comments?space=${owner.me.id}&id=fix-sink`),
		);
		expect(listed.comments.map(c => c.id)).toEqual(['c-owner']);
	});

	test('revoking the share turns the guest away and drops the membership', async () => {
		await seedOwner();
		const created = await userShare();
		await settled();
		expect((await sync(guest, [], owner.me.id)).status).toBe(200);
		expect(await json<Ok>(call(owner, 'DELETE', `/api/shares?id=${created.id}`))).toEqual({ ok: true });
		await settled();
		expect((await sync(guest, [], owner.me.id)).status).toBe(403);
		expect(await json<Spaces>(call(guest, 'GET', '/api/spaces'))).toEqual({ spaces: [] });
	});

	test('a recurring completion shows as completed in the activity', async () => {
		await seedOwner();
		await userShare();
		await json(
			sync(
				guest,
				[op(guest, 'paint', { due: { date: '2026-10-26', time: null }, lastCompletedAt: NOW + 30 })],
				owner.me.id,
			),
		);
		const { entries } = await json<{ entries: ActivityEntry[] }>(
			call(guest, 'GET', `/api/activity?space=${owner.me.id}&id=paint`),
		);
		expect(entries.map(e => [e.action, e.actor.id])).toEqual([
			['created', owner.me.id],
			['completed', guest.me.id],
		]);
		expect((await snapshotOf(sync(owner))).tasks.find(t => t.id === 'paint')).toMatchObject({
			completedAt: null,
			completedBy: guest.me.id,
			due: { date: '2026-10-26', time: null },
		});
	});

	test('a link shows the shared label’s tasks to anyone, and nothing else', async () => {
		await seedOwner();
		const link = await share({ kind: 'label', id: 'urgent' }, { kind: 'link' });
		expect(link.url).toBe(`https://procrastimate.test/s/${owner.me.id}.${link.id}`);
		expect(link.role).toBe('view');
		expect(await share({ kind: 'label', id: 'urgent' }, { kind: 'link' })).toEqual(link);

		const view = await json<SharedView>(call(null, 'GET', `/api/shared?token=${owner.me.id}.${link.id}`));
		expect(view.owner).toEqual({ id: owner.me.id, name: 'Test', kind: 'human', ownerId: null });
		expect(view.target).toEqual({ kind: 'label', id: 'urgent' });
		expect(view.tasks.map(t => t.title)).toEqual(['Do taxes']);
		expect(view.projects).toEqual([]);
		expect(view.labels).toEqual([label('urgent', { name: 'Urgent', color: 'red', createdAt: NOW })]);
		expect((await call(null, 'GET', `/api/shared?token=${owner.me.id}.nope`)).status).toBe(404);

		const missing = await call(owner, 'POST', '/api/shares', {
			target: { kind: 'project', id: 'missing' },
			audience: { kind: 'link' },
		});
		expect(missing.status).toBe(404);
	});

	test('an AI account acts on its owner’s space with a token, and only through the agent routes', async () => {
		await seedOwner();
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Butler' }));
		expect(ai).toEqual({ id: ai.id, name: 'Butler', kind: 'ai', ownerId: owner.me.id });
		expect(await json<{ accounts: Person[] }>(call(owner, 'GET', '/api/ai'))).toEqual({ accounts: [ai] });
		const { token } = await json<{ id: string; token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
		expect(token.startsWith(`pm.${owner.me.id}.`)).toBe(true);
		const asAi = (method: string, path: string, body?: unknown) =>
			api.fetch(
				new Request(`https://procrastimate.test${path}`, {
					method,
					headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
					body: body === undefined ? undefined : JSON.stringify(body),
				}),
				owner.env,
			);

		const added = await json<Task>(asAi('POST', '/api/tasks', { text: 'Call the plumber tomorrow #Home @urgent p1' }));
		expect(added).toMatchObject({
			title: 'Call the plumber',
			projectId: 'home',
			labelIds: ['urgent'],
			priority: 1,
			due: { date: '2026-10-15', time: null },
			createdBy: ai.id,
		});
		const seen = await json<SpaceView>(asAi('GET', '/api/view'));
		expect(seen.tasks.map(t => t.title)).toContain('Call the plumber');
		expect(seen.readOnly).toEqual([]);
		expect(await json<Task>(asAi('POST', `/api/tasks/complete?id=${added.id}`))).toMatchObject({
			completedAt: NOW,
			completedBy: ai.id,
		});

		const posted = await json<TaskComment>(
			asAi('POST', '/api/comments', { taskId: 'fix-sink', body: ' Plumber booked ' }),
		);
		expect(posted).toEqual({
			id: posted.id,
			taskId: 'fix-sink',
			body: 'Plumber booked',
			authorId: ai.id,
			author: ai,
			createdAt: NOW,
			editedAt: null,
		});
		await json(sync(owner, [comment(owner, 'c-owner', 'fix-sink', 'Thanks')]));
		expect((await asAi('PATCH', '/api/comments?id=c-owner', { body: 'Not yours' })).status).toBe(403);
		expect((await asAi('POST', '/api/comments', { taskId: 'fix-sink', body: '  ' })).status).toBe(400);
		expect((await asAi('POST', '/api/comments', { taskId: 'nope', body: 'Hi' })).status).toBe(404);
		expect(
			await json<TaskComment>(asAi('PATCH', `/api/comments?id=${posted.id}`, { body: 'Booked for 9' })),
		).toMatchObject({ body: 'Booked for 9', editedAt: NOW });
		const listed = await json<{ comments: TaskComment[] }>(asAi('GET', '/api/comments?id=fix-sink'));
		expect(listed.comments.map(c => [c.body, c.author.name])).toEqual([
			['Booked for 9', 'Butler'],
			['Thanks', 'Test'],
		]);
		expect(await json<Ok>(asAi('DELETE', `/api/comments?id=${posted.id}`))).toEqual({ ok: true });
		expect((await json<{ comments: TaskComment[] }>(asAi('GET', '/api/comments?id=fix-sink'))).comments).toHaveLength(
			1,
		);

		expect((await asAi('GET', '/api/shares')).status).toBe(403);
		expect(
			(await asAi('POST', '/api/shares', { target: { kind: 'space', id: '' }, audience: { kind: 'link' } })).status,
		).toBe(403);
		expect((await asAi('GET', '/api/ai-tokens')).status).toBe(403);
		expect((await asAi('GET', '/api/me')).status).toBe(403);
		expect((await asAi('POST', `/api/sync?space=${ai.id}`, { cursor: 0, ops: [], reset: true })).status).toBe(403);

		const { entries } = await json<{ entries: ActivityEntry[] }>(call(owner, 'GET', `/api/activity?id=${added.id}`));
		expect(entries.map(e => [e.action, e.actor.name, e.actor.kind])).toEqual([
			['created', 'Butler', 'ai'],
			['completed', 'Butler', 'ai'],
		]);

		expect(await json<Ok>(call(owner, 'DELETE', `/api/ai?id=${ai.id}`))).toEqual({ ok: true });
		expect((await asAi('GET', '/api/view')).status).toBe(401);
		expect(await json<{ tokens: unknown[] }>(call(owner, 'GET', '/api/ai-tokens'))).toEqual({ tokens: [] });
	});

	test('the agent API reports which app created each task and which wrote to it last', async () => {
		const web = { kind: 'web', version: 'abc123', device: 'Chrome', os: 'macOS', timeZone: 'Europe/Lisbon' } as const;
		await json(
			call(
				owner,
				'POST',
				'/api/sync',
				{ cursor: 0, ops: [create(owner, task('rent', { title: 'Pay rent' }))] },
				{
					[CLIENT_HEADER]: JSON.stringify(web),
				},
			),
		);
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Butler' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
		const asAi = (method: string, path: string, body?: unknown) =>
			call(null, method, path, body, { Authorization: `Bearer ${token}`, 'user-agent': 'butler/1.0' });
		const bot = { kind: 'api', version: null, device: 'butler/1.0', os: null, timeZone: null } as const;

		const added = await json<AgentTask>(asAi('POST', '/api/tasks', { title: 'Call the plumber' }));
		expect(added.clients).toEqual({ created: { ...bot, at: NOW }, edited: { ...bot, at: NOW } });
		setSystemTime(NOW + 60_000);
		const edited = await json<AgentTask>(asAi('PATCH', '/api/tasks?id=rent', { notes: 'By Friday' }));
		expect(edited.clients).toEqual({ created: { ...web, at: NOW }, edited: { ...bot, at: NOW + 60_000 } });

		const seen = await json<SpaceView>(asAi('GET', '/api/view'));
		expect(Object.fromEntries(seen.tasks.map(t => [t.title, t.clients.created?.kind]))).toEqual({
			'Pay rent': 'web',
			'Call the plumber': 'api',
		});

		const garbled = await call(
			owner,
			'POST',
			'/api/sync',
			{ cursor: 0, ops: [] },
			{ [CLIENT_HEADER]: '{"kind":"api"}' },
		);
		expect(garbled.status).toBe(400);
	});

	test('a reset re-upload keeps which app created and last changed each task', async () => {
		const web = { kind: 'web', version: 'abc123', device: 'Chrome', os: 'macOS', timeZone: 'Europe/Lisbon' } as const;
		const ios = { kind: 'ios', version: '1.4 (212)', device: 'iPhone17,1', os: 'iOS 27.0', timeZone: 'UTC' } as const;
		const rent = task('rent', { title: 'Pay rent' });
		await json(
			call(
				owner,
				'POST',
				'/api/sync',
				{ cursor: 0, ops: [create(owner, rent)] },
				{ [CLIENT_HEADER]: JSON.stringify(web) },
			),
		);
		setSystemTime(NOW + 60_000);
		await json(
			call(
				owner,
				'POST',
				'/api/sync',
				{ cursor: 0, epoch: 0, reset: true, ops: [create(owner, rent), create(owner, task('gym', { title: 'Gym' }))] },
				{ [CLIENT_HEADER]: JSON.stringify(ios) },
			),
		);
		setSystemTime(NOW + 120_000);
		await json(
			call(
				owner,
				'POST',
				'/api/sync',
				{ cursor: 0, epoch: 1, ops: [op(owner, 'gym', { notes: 'Legs' })] },
				{ [CLIENT_HEADER]: JSON.stringify(ios) },
			),
		);

		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Butler' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
		const seen = await json<SpaceView>(call(null, 'GET', '/api/view', undefined, { Authorization: `Bearer ${token}` }));
		expect(Object.fromEntries(seen.tasks.map(t => [t.title, t.clients]))).toEqual({
			'Pay rent': { created: { ...web, at: NOW }, edited: { ...web, at: NOW } },
			Gym: { created: { ...ios, at: NOW + 60_000 }, edited: { ...ios, at: NOW + 120_000 } },
		});
	});

	test('two spaces shared with each other sync at the same time without waiting on one another', async () => {
		await setUp(40);
		await seedOwner();
		await userShare();
		await json(
			sync(guest, [
				{ ...op(guest, 'work', { deleted: false, name: 'Work', createdAt: NOW, sourceKey: null }, 'project') },
			]),
		);
		await json(
			call(guest, 'POST', '/api/shares', {
				target: { kind: 'project', id: 'work' },
				audience: { kind: 'user', userId: owner.me.id, role: 'edit' },
			}),
		);
		await settled();
		const both = await Promise.race([
			Promise.all([
				json(
					sync(owner, [create(owner, task('o1', { title: 'Owner moves', projectId: 'home', createdAt: NOW + 40 }))]),
				),
				json(
					sync(guest, [create(guest, task('g1', { title: 'Guest moves', projectId: 'work', createdAt: NOW + 41 }))]),
				),
				json(
					sync(
						owner,
						[create(owner, task('o2', { title: 'Owner in Work', projectId: 'work', createdAt: NOW + 42 }))],
						guest.me.id,
					),
				),
				json(
					sync(
						guest,
						[create(guest, task('g2', { title: 'Guest in Home', projectId: 'home', createdAt: NOW + 43 }))],
						owner.me.id,
					),
				),
			]),
			new Promise<'stuck'>(resolve => setTimeout(() => resolve('stuck'), 2000)),
		]);
		expect(both).not.toBe('stuck');
		const ownersHome = (await snapshotOf(sync(owner))).tasks.map(t => t.title);
		expect(ownersHome).toContain('Guest in Home');
		const guestsWork = (await snapshotOf(sync(guest))).tasks.map(t => t.title);
		expect(guestsWork).toEqual(['Guest moves', 'Owner in Work']);
	});

	/** Owner-only: project Secret with an imported task and its subtask, and a label no shared task carries. */
	const seedPrivate = () =>
		json(
			sync(owner, [
				op(owner, 'secret', { deleted: false, name: 'Secret', createdAt: NOW, sourceKey: null }, 'project'),
				op(owner, 'private-label', { deleted: false, name: 'Private', createdAt: NOW }, 'label'),
				create(
					owner,
					task('diary', { title: 'Diary', projectId: 'secret', sourceKey: 'todoist:task:1', createdAt: NOW + 5 }),
				),
				create(owner, task('entry', { title: 'Entry', projectId: 'secret', parentId: 'diary', createdAt: NOW + 6 })),
			]),
		);

	test('a guest cannot take over a private imported task by sending its source key', async () => {
		await seedOwner();
		await seedPrivate();
		await userShare();
		await settled();
		const imposter = task('imposter', {
			title: 'Imposter',
			projectId: 'home',
			sourceKey: 'todoist:task:1',
			createdAt: NOW - 1000,
		});
		const seen = await snapshotOf(sync(guest, [create(guest, imposter)], owner.me.id));
		expect(seen.tasks.map(t => t.id)).toEqual(['fix-sink', 'buy-washer', 'paint']);
		const own = await snapshotOf(sync(owner));
		expect(own.tasks.filter(t => t.projectId === 'secret').map(t => [t.id, t.parentId])).toEqual([
			['diary', null],
			['entry', 'diary'],
		]);
	});

	test('a guest cannot point a shared task at a private parent, project, or label', async () => {
		await seedOwner();
		await seedPrivate();
		await share({ kind: 'label', id: 'urgent' }, { kind: 'user', userId: guest.me.id, role: 'edit' });
		await settled();
		const seen = await snapshotOf(
			sync(
				guest,
				[
					op(guest, 'taxes', { parentId: 'diary' }),
					op(guest, 'taxes', { projectId: 'secret' }),
					op(guest, 'taxes', { labelIds: ['urgent', 'private-label'] }),
					op(guest, 'taxes', { title: 'Do the taxes' }),
				],
				owner.me.id,
			),
		);
		expect(seen.tasks.map(t => [t.id, t.title, t.parentId, t.projectId, t.labelIds])).toEqual([
			['taxes', 'Do the taxes', null, null, ['urgent']],
		]);
		expect(seen.projects).toEqual([]);
		expect(seen.labels.map(l => l.name)).toEqual(['Urgent']);
	});

	test('an AI account organizes the space and publishes read-only links; a guest may do neither', async () => {
		await seedOwner();
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Butler' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
		const asAi = (method: string, path: string, body?: unknown) =>
			call(null, method, path, body, { Authorization: `Bearer ${token}` });

		const garden = await json<{ id: string; name: string }>(asAi('POST', '/api/projects', { name: ' Garden ' }));
		expect(garden.name).toBe('Garden');
		expect(await json(asAi('POST', '/api/projects', { name: 'garden' }))).toMatchObject({ id: garden.id });
		expect((await asAi('PATCH', `/api/projects?id=${garden.id}`, { name: 'HOME' })).status).toBe(400);
		const inOrder = async () => projectsInOrder((await json<SpaceView>(asAi('GET', '/api/view'))).projects);
		expect((await inOrder()).map(p => p.name)).toEqual(['Home', 'Garden']);
		expect(await json(asAi('PATCH', `/api/projects?id=${garden.id}`, { index: 0 }))).toMatchObject({ name: 'Garden' });
		expect((await inOrder()).map(p => p.name)).toEqual(['Garden', 'Home']);
		const later = await json<{ id: string }>(asAi('POST', '/api/sections', { projectId: garden.id, name: 'Later' }));
		const soon = await json<{ id: string }>(asAi('POST', '/api/sections', { projectId: garden.id, name: 'Soon' }));
		expect(await json(asAi('POST', '/api/sections', { projectId: garden.id, name: 'later' }))).toMatchObject({
			id: later.id,
		});
		await json(asAi('PATCH', `/api/sections?id=${soon.id}`, { index: 0 }));
		const ordered = (await json<SpaceView>(asAi('GET', '/api/view'))).sections.toSorted((a, b) => a.order - b.order);
		expect(ordered.map(s => s.name)).toEqual(['Soon', 'Later']);
		expect((await asAi('PATCH', `/api/sections?id=${soon.id}`, { name: 'Later' })).status).toBe(400);
		const waiting = await json<{ id: string }>(asAi('POST', '/api/labels', { name: 'waiting', color: 'orange' }));
		expect(await json(asAi('POST', '/api/labels', { name: 'Waiting' }))).toMatchObject({ id: waiting.id });
		expect((await asAi('PATCH', `/api/labels?id=${waiting.id}`, { name: 'urgent' })).status).toBe(400);
		const seeds = await json<Task>(asAi('POST', '/api/tasks', { text: 'Plant seeds #Garden /Soon @waiting' }));
		expect(seeds).toMatchObject({ projectId: garden.id, sectionId: soon.id, labelIds: [waiting.id] });

		const link = await json<ShareView>(asAi('POST', '/api/links', { target: { kind: 'task', id: seeds.id } }));
		expect(link).toMatchObject({ grantee: null, role: 'view', target: { kind: 'task', id: seeds.id } });
		expect(link.url).toBe(`https://procrastimate.test/s/${owner.me.id}.${link.id}`);
		const published = await json<SharedView>(call(null, 'GET', `/api/shared?token=${owner.me.id}.${link.id}`));
		expect(published.tasks.map(t => t.title)).toEqual(['Plant seeds']);
		expect(published.projects.map(p => p.name)).toEqual(['Garden']);
		const ownerLink = await share({ kind: 'label', id: 'urgent' }, { kind: 'link' });
		await userShare();
		expect((await json<{ links: ShareView[] }>(asAi('GET', '/api/links'))).links.map(l => l.id).toSorted()).toEqual(
			[link.id, ownerLink.id].toSorted(),
		);
		expect((await asAi('POST', '/api/links', { target: { kind: 'space', id: '' } })).status).toBe(400);
		expect(await json<Ok>(asAi('DELETE', `/api/links?id=${link.id}`))).toEqual({ ok: true });
		expect((await call(null, 'GET', `/api/shared?token=${owner.me.id}.${link.id}`)).status).toBe(404);

		const inGuest = (method: string, path: string, body?: unknown) =>
			call(guest, method, `${path}${path.includes('?') ? '&' : '?'}space=${owner.me.id}`, body);
		const wholeSpace = (audience: unknown) =>
			call(owner, 'POST', '/api/shares', { target: { kind: 'space', id: '' }, audience });
		expect((await wholeSpace({ kind: 'user', userId: guest.me.id, role: 'edit' })).status).toBe(400);
		expect((await wholeSpace({ kind: 'link' })).status).toBe(400);
		expect((await inGuest('GET', '/api/links')).status).toBe(403);
		expect((await inGuest('POST', '/api/links', { target: { kind: 'task', id: 'fix-sink' } })).status).toBe(403);
		expect((await inGuest('POST', '/api/projects', { name: 'Mine' })).status).toBe(403);
		expect((await inGuest('PATCH', '/api/projects?id=home', { name: 'Ours' })).status).toBe(403);
		expect((await json<SpaceView>(inGuest('GET', '/api/view'))).labels).toEqual([]);
		expect((await inGuest('POST', '/api/labels', { name: 'URGENT' })).status).toBe(403);
		expect((await inGuest('POST', '/api/sections', { projectId: 'home', name: 'Mine' })).status).toBe(403);

		expect(await json<Ok>(asAi('DELETE', `/api/labels?id=${waiting.id}`))).toEqual({ ok: true });
		expect(await json<Ok>(asAi('DELETE', `/api/projects?id=${garden.id}`))).toEqual({ ok: true });
		const after = await snapshotOf(sync(owner));
		expect(after.projects.map(p => p.name)).toEqual(['Home']);
		expect(after.sections).toEqual([]);
		expect(after.labels.map(l => l.name)).toEqual(['Urgent']);
		expect(after.tasks.some(t => t.title === 'Plant seeds')).toBe(false);
	});

	test('an AI account saves a place, resizes it, and puts tasks at it with @name', async () => {
		await seedOwner();
		const ai = await json<Person>(call(owner, 'POST', '/api/ai', { name: 'Butler' }));
		const { token } = await json<{ token: string }>(
			call(owner, 'POST', '/api/ai-tokens', { aiUserId: ai.id, name: 'laptop' }),
		);
		const asAi = (method: string, path: string, body?: unknown) =>
			call(null, method, path, body, { Authorization: `Bearer ${token}` });
		const spot = { address: '1 Main St', latitude: 52.52, longitude: 13.405 };

		expect(
			(await asAi('POST', '/api/labels', { name: 'gym', place: { ...spot, latitude: 95, radius: 100 } })).status,
		).toBe(400);
		expect((await asAi('POST', '/api/labels', { name: 'gym', place: { ...spot, radius: 0 } })).status).toBe(400);
		expect((await asAi('POST', '/api/labels', { name: 'urgent', place: { ...spot, radius: 100 } })).status).toBe(400);
		const gym = await json<Label>(asAi('POST', '/api/labels', { name: 'Gym', place: { ...spot, radius: 100 } }));
		expect(gym.place).toEqual({ ...spot, radius: 100 });
		expect(await json(asAi('POST', '/api/labels', { name: 'gym', place: { ...spot, radius: 5 } }))).toMatchObject({
			id: gym.id,
			place: { radius: 100 },
		});

		const stretch = await json<Task>(asAi('POST', '/api/tasks', { text: 'Stretch @gym' }));
		expect(stretch).toMatchObject({
			title: 'Stretch',
			labelIds: [],
			location: { name: 'Gym', ...spot, radius: 100, trigger: 'arrive' },
		});
		const lift = await json<Task>(asAi('POST', '/api/tasks', { title: 'Lift' }));
		expect(await json(asAi('PATCH', `/api/tasks?id=${lift.id}`, { labelIds: ['urgent', gym.id] }))).toMatchObject({
			labelIds: ['urgent'],
			location: { name: 'Gym', radius: 100 },
		});

		expect(await json(asAi('PATCH', `/api/labels?id=${gym.id}`, { radius: 250 }))).toMatchObject({
			place: { radius: 250 },
		});
		expect((await asAi('PATCH', '/api/labels?id=urgent', { radius: 250 })).status).toBe(400);
		expect((await asAi('PATCH', `/api/labels?id=${gym.id}`, { radius: -1 })).status).toBe(400);
		const after = await snapshotOf(sync(owner));
		expect(after.tasks.filter(t => t.location).map(t => [t.title, t.location?.radius])).toEqual([
			['Stretch', 250],
			['Lift', 250],
		]);
	});

	test('a stranger is turned away from a space, and a guest from its owner-only routes', async () => {
		await seedOwner();
		expect((await sync(guest, [], owner.me.id)).status).toBe(403);
		expect((await call(guest, 'GET', `/api/view?space=${owner.me.id}`)).status).toBe(403);
		await userShare();
		expect((await call(guest, 'GET', `/api/view?space=${owner.me.id}`)).status).toBe(200);
		expect((await call(guest, 'GET', `/api/shares?space=${owner.me.id}`)).status).toBe(403);
		expect((await call(guest, 'GET', `/api/ai-tokens?space=${owner.me.id}`)).status).toBe(403);
	});
});

test('project tasks reach their subtasks through the parent, not the subtask’s own project', async () => {
	const snapshot: Snapshot = {
		tasks: [task('root', { projectId: 'p' }), task('child', { parentId: 'root', projectId: 'p' })],
		projects: [project('p')],
		sections: [],
		labels: [],
		comments: [],
		reads: [],
		settings: DEFAULT_SETTINGS,
	};
	const { scopeOf } = await import('../../../shared/scope');
	const scope = scopeOf(snapshot, [{ targetKind: 'task', targetId: 'root', role: 'view' }]);
	expect([...scope.tasks]).toEqual(['root', 'child']);
	expect([...scope.editable]).toEqual([]);
	expect([...scope.projects]).toEqual(['p']);
});

test('a guest sees every section and comment its tasks reach, and may not put a task in any other section', async () => {
	const snapshot: Snapshot = {
		tasks: [
			task('shared', { projectId: 'p', labelIds: ['l'] }),
			task('private', { projectId: 'q', sectionId: 'q-later' }),
		],
		projects: [project('p'), project('q')],
		sections: [section('p-next', 'p'), section('p-later', 'p'), section('q-later', 'q')],
		labels: [label('l')],
		comments: [
			{ id: 'c-shared', taskId: 'shared', body: 'Yes', authorId: 'owner', createdAt: 1, editedAt: null },
			{ id: 'c-private', taskId: 'private', body: 'No', authorId: 'owner', createdAt: 2, editedAt: null },
		],
		reads: [],
		settings: DEFAULT_SETTINGS,
	};
	const { admit, filterSnapshot, scopeOf } = await import('../../../shared/scope');
	const grants = [{ targetKind: 'label', targetId: 'l', role: 'edit' }] as const;
	expect(filterSnapshot(snapshot, scopeOf(snapshot, grants)).sections.map(s => s.id)).toEqual(['p-next', 'p-later']);
	expect(filterSnapshot(snapshot, scopeOf(snapshot, grants)).comments.map(c => c.id)).toEqual(['c-shared']);
	const hlc = formatHlc({ wall: NOW, counter: 0, node: 'd' });
	const move = (sectionId: string): Op => ({ opId: sectionId, hlc, kind: 'task', id: 'shared', fields: { sectionId } });
	const rename: Op = { opId: 'rename', hlc, kind: 'section', id: 'p-next', fields: { name: 'Mine' } };
	const { admitted, refused } = admit(snapshot, grants, [move('p-later'), move('q-later'), rename], 'guest');
	expect([admitted.map(o => o.opId), refused.map(o => o.opId)]).toEqual([['p-later'], ['q-later', 'rename']]);
});
