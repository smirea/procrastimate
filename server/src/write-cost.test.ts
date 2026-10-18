import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { json, signUp, taskRow, testApp, upload, type Session, type TestApp } from './test-app';

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

/** The statements an upload ran, as their first word or `lock` for an advisory lock, so a failure names what ran. */
async function statementsOf(session: Session, writes: unknown[]): Promise<string[]> {
	app.statements.length = 0;
	expect(await upload(app, session, writes)).toEqual([]);
	return app.statements.map(statement => {
		if (statement.startsWith('SELECT pg_advisory_xact_lock')) return 'lock';
		return statement.trim().split(/\s+/)[0]!.toLowerCase();
	});
}

const patch = (values: Record<string, unknown>, opId = crypto.randomUUID()) => [
	{ op: 'patch', table: 'tasks', id, values, opId },
];

describe('statements per upload', () => {
	test('an owner’s title edit is the update and the log row', async () => {
		expect(await statementsOf(owner, patch({ title: 'Renamed' }))).toEqual(['update', 'insert']);
	});

	test('an owner’s due date change also asks for a push subscription, and plans only when there is one', async () => {
		const due = (date: string) => patch({ due: JSON.stringify({ date, time: '09:00' }) });
		expect(await statementsOf(owner, due('2026-10-20'))).toEqual(['update', 'insert', 'select']);
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
			'update',
			'insert',
			'select',
			'select',
			'select',
			'update',
		]);
		await app.fetch('/api/push/subscription', { method: 'DELETE', headers: owner.headers });
	});

	test('a settings change replans only when the time zone moved', async () => {
		const settings = (values: Record<string, unknown>) => [{ op: 'patch', table: 'settings', id: 'settings', values }];
		expect(await statementsOf(owner, settings({ dictation: 'elevenlabs' }))).toEqual(['update', 'insert']);
		expect(await statementsOf(owner, settings({ time_zone: 'Europe/Madrid' }))).toEqual(['update', 'insert', 'select']);
	});

	test('a guest’s edit tries the own space, looks the row up, locks the space shared, reads the guest’s access rows, writes in a savepoint, and logs', async () => {
		await json(
			app.fetch('/api/shares', {
				method: 'POST',
				headers: owner.headers,
				body: JSON.stringify({
					target: { kind: 'task', id },
					audience: { kind: 'user', userId: guest.person.id, role: 'edit' },
				}),
			}),
		);
		expect(await statementsOf(guest, patch({ title: 'By the guest' }))).toEqual([
			'update',
			'select',
			'lock',
			'select',
			'savepoint',
			'update',
			'release',
			'insert',
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
		// The pre-check, the lock, the shares to humans and the stored rows, then the tree, then the changed rows.
		expect(await statementsOf(owner, patch({ project_id: projectId }))).toEqual([
			'update',
			'insert',
			'select',
			'lock',
			'select',
			'select',
			'select',
			'select',
			'select',
			'select',
			'insert',
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
		expect(first.slice(0, 3).toSorted()).toEqual(['insert', 'insert', 'update']);
		expect(again).toEqual(first);
	});
});
