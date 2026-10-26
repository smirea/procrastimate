import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { json, named, type Session, shareWith, signUp, taskRow, testApp, type TestApp, upload } from './test-app';

/**
 * What one upload costs in SQL statements, counted by the test app's Drizzle logger. Sessions are warmed first, so
 * the counts are the write path's alone: the bearer session cache answers the auth. Every count is literal on
 * purpose, so a statement that creeps back in fails here. The logger sees no `BEGIN` or `COMMIT`, so a guest's
 * transaction costs two more round trips than its list shows.
 */

let app: TestApp;
let owner: Session;
let guest: Session;
let id: string;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
	guest = await signUp(app, 'Guest');
	id = crypto.randomUUID();
	await Promise.all([
		app.fetch('/api/me', { headers: owner.headers }),
		app.fetch('/api/me', { headers: guest.headers }),
	]);
	await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Costed') }]);
});
afterAll(() => app.close());

/** The statements an upload ran, each as its verb and table, so a failure names what ran. */
async function statementsOf(session: Session, writes: unknown[]): Promise<string[]> {
	app.statements.length = 0;
	expect(await upload(app, session, writes)).toEqual([]);
	return app.statements.map(named);
}

const patch = (values: Record<string, unknown>, opId = crypto.randomUUID()) => [
	{ op: 'patch', table: 'tasks', id, values, opId },
];

describe('statements per upload', () => {
	test('an owner’s title edit is the update and the log row', async () => {
		expect(await statementsOf(owner, patch({ title: 'Renamed' }))).toEqual(['update tasks', 'insert log']);
	});

	test('an owner’s due date change also asks for a push subscription, and plans only when there is one', async () => {
		const due = (date: string) => patch({ due: JSON.stringify({ date, time: '09:00' }) });
		expect(await statementsOf(owner, due('2026-10-20'))).toEqual(['update tasks', 'insert log', 'select push']);
		await json(
			app.fetch('/api/push/subscription', {
				method: 'PUT',
				headers: owner.headers,
				body: JSON.stringify({
					subscription: { endpoint: 'https://push.example/cost', keys: { p256dh: 'p', auth: 'a' } },
				}),
			}),
		);
		expect(await statementsOf(owner, due('2026-10-21'))).toEqual([
			'update tasks',
			'insert log',
			'select push',
			'select settings',
			'select tasks',
			'update push',
		]);
		await app.fetch('/api/push/subscription', { method: 'DELETE', headers: owner.headers });
	});

	test('a settings change replans only when the time zone moved', async () => {
		const settings = (values: Record<string, unknown>) => [{ op: 'patch', table: 'settings', id: 'settings', values }];
		expect(await statementsOf(owner, settings({ dictation: 'elevenlabs' }))).toEqual(['update settings', 'insert log']);
		expect(await statementsOf(owner, settings({ time_zone: 'Europe/Madrid' }))).toEqual([
			'update settings',
			'insert log',
			'select push',
		]);
	});

	test('a guest’s edit tries the own space, looks the row up, locks the space shared, reads the guest’s access rows, writes in a savepoint, and logs', async () => {
		await shareWith(app, owner, { kind: 'task', id }, guest.person.id, 'edit');
		expect(await statementsOf(guest, patch({ title: 'By the guest' }))).toEqual([
			'update tasks',
			'select tasks',
			'lock',
			'select access',
			'savepoint',
			'update tasks',
			'release',
			'insert log',
		]);
	});

	test('a move in a space with a human grantee recomputes access under the lock', async () => {
		const projectId = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'projects',
				id: projectId,
				values: { id: projectId, user_id: owner.person.id, name: 'Moved into', created_at: 1 },
			},
		]);
		// Its own task and human grantee, so the test holds alone and not only after the guest's edit above.
		const moved = crypto.randomUUID();
		await upload(app, owner, [
			{ op: 'put', table: 'tasks', id: moved, values: taskRow(moved, owner.person.id, 'Moved') },
		]);
		await shareWith(app, owner, { kind: 'project', id: projectId }, guest.person.id, 'view');
		// The push check, since a group of notifications opens its project, then the pre-check, the lock, the shares to
		// humans and the stored rows, then the tree, then the changed rows.
		const move = [
			{ op: 'patch', table: 'tasks', id: moved, values: { project_id: projectId }, opId: crypto.randomUUID() },
		];
		expect(await statementsOf(owner, move)).toEqual([
			'update tasks',
			'insert log',
			'select push',
			'select shares',
			'lock',
			'select shares',
			'select access',
			'select tasks',
			'select projects',
			'select sections',
			'select labels',
			'insert access',
		]);
	});

	test('an owner’s delete in a shared space recomputes access, then asks whether the space still holds a row', async () => {
		const doomed = crypto.randomUUID();
		await upload(app, owner, [
			{ op: 'put', table: 'tasks', id: doomed, values: taskRow(doomed, owner.person.id, 'Doomed') },
		]);
		expect(await statementsOf(owner, [{ op: 'delete', table: 'tasks', id: doomed }])).toEqual([
			'delete tasks',
			'insert log',
			'select push',
			'select shares',
			'lock',
			'select shares',
			'select access',
			'select tasks',
			'select projects',
			'select sections',
			'select labels',
			'select tasks',
		]);
	});

	test('a retried batch runs the same statements and the log insert is ignored', async () => {
		const fresh = crypto.randomUUID();
		const batch = [
			{ op: 'put', table: 'tasks', id: fresh, values: taskRow(fresh, owner.person.id, 'Twice'), opId: `${fresh}:1` },
			{ op: 'patch', table: 'tasks', id, values: { notes: 'twice' }, opId: `${fresh}:2` },
		];
		const first = await statementsOf(owner, batch);
		const again = await statementsOf(owner, batch);
		expect(first.slice(0, 3).toSorted()).toEqual(['insert log', 'insert tasks', 'update tasks']);
		expect(again).toEqual(first);
	});
});
