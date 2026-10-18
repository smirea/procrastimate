import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { ActivityEntry, ShareView } from '../../shared/sharing';
import { COALESCE_WINDOW } from './activity';
import { json, signUp, taskRow, testApp, upload, type Session, type TestApp } from './test-app';

const START = Date.UTC(2026, 9, 14, 18, 0);
beforeEach(() => setSystemTime(START));
afterEach(() => setSystemTime());

let app: TestApp;
let owner: Session;
let guest: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
	guest = await signUp(app, 'Guest');
});
afterAll(() => app.close());

const activity = async (id: string) =>
	(
		await json<{ entries: ActivityEntry[] }>(app.fetch(`/api/activity?id=${id}`, { headers: owner.headers }))
	).entries.map(entry => `${entry.actor.name} ${entry.action}: ${entry.summary}`);

const later = (ms: number) => setSystemTime(START + ms);

describe('GET /api/activity', () => {
	test('creation, a guest’s edits folded within the window, a completion, and a comment', async () => {
		const id = crypto.randomUUID();
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Draft') }]);
		await json<ShareView>(
			app.fetch('/api/shares', {
				method: 'POST',
				headers: owner.headers,
				body: JSON.stringify({
					target: { kind: 'task', id },
					audience: { kind: 'user', userId: guest.person.id, role: 'edit' },
				}),
			}),
		);
		later(60_000);
		await upload(app, guest, [{ op: 'patch', table: 'tasks', id, values: { title: 'Draft the plan' } }]);
		later(120_000);
		await upload(app, guest, [{ op: 'patch', table: 'tasks', id, values: { priority: 1, notes: 'Two pages' } }]);
		later(COALESCE_WINDOW + 180_000);
		await app.fetch(`/api/tasks/complete?id=${id}`, { method: 'POST', headers: owner.headers });
		later(COALESCE_WINDOW + 240_000);
		const comment = crypto.randomUUID();
		await upload(app, guest, [
			{
				op: 'put',
				table: 'comments',
				id: comment,
				values: {
					id: comment,
					user_id: owner.person.id,
					task_id: id,
					body: 'Done reading',
					author_id: null,
					created_at: 1,
					edited_at: null,
				},
			},
		]);
		expect(await activity(id)).toEqual([
			'Owner created: added this task',
			'Guest edited: renamed it to “Draft the plan”, added notes and changed priority to P1',
			'Owner completed: completed it',
			'Guest commented: commented “Done reading”',
		]);
	});

	test('a completion undone at once by the same actor shows neither, and a re-upload of the same values shows nothing', async () => {
		const id = crypto.randomUUID();
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Flip') }]);
		later(1000);
		await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values: { completed_at: START + 1000 } }]);
		later(2000);
		await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values: { completed_at: null } }]);
		later(3000);
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Flip') }]);
		expect(await activity(id)).toEqual(['Owner created: added this task']);
	});

	test('a delete and a re-put read as deleted and restored, and a stranger gets 404', async () => {
		const id = crypto.randomUUID();
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Gone') }]);
		later(COALESCE_WINDOW + 1000);
		await upload(app, owner, [{ op: 'delete', table: 'tasks', id }]);
		later(2 * COALESCE_WINDOW + 2000);
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Gone') }]);
		expect(await activity(id)).toEqual([
			'Owner created: added this task',
			'Owner deleted: deleted it',
			'Owner restored: restored it',
		]);
		const stranger = await signUp(app, 'Stranger');
		expect(
			(await app.fetch(`/api/activity?id=${id}&space=${owner.person.id}`, { headers: stranger.headers })).status,
		).toBe(403);
	});

	test('an edit names the project, label, and parent it points at, and a guest reads only what it sees', async () => {
		const project = crypto.randomUUID();
		const label = crypto.randomUUID();
		const parent = crypto.randomUUID();
		const id = crypto.randomUUID();
		const hidden = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'projects',
				id: project,
				values: { id: project, user_id: owner.person.id, name: 'Errands', created_at: 1 },
			},
			{
				op: 'put',
				table: 'labels',
				id: label,
				values: { id: label, user_id: owner.person.id, name: 'home', created_at: 1 },
			},
			{ op: 'put', table: 'tasks', id: parent, values: taskRow(parent, owner.person.id, 'Trip') },
			{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Pack') },
			{ op: 'put', table: 'tasks', id: hidden, values: taskRow(hidden, owner.person.id, 'Hidden') },
		]);
		const step = async (n: number, values: Record<string, unknown>) => {
			later(n * (COALESCE_WINDOW + 1000));
			expect(await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values }])).toEqual([]);
		};
		await step(1, { project_id: project });
		await step(2, { label_ids: JSON.stringify([label]) });
		await step(3, { parent_id: parent });
		const named = [
			'Owner created: added this task',
			'Owner edited: moved it to Errands',
			'Owner edited: added label home',
			'Owner edited: made it a subtask of “Trip”',
		];
		expect(await activity(id)).toEqual(named);
		await json<ShareView>(
			app.fetch('/api/shares', {
				method: 'POST',
				headers: owner.headers,
				body: JSON.stringify({
					target: { kind: 'task', id },
					audience: { kind: 'user', userId: guest.person.id, role: 'view' },
				}),
			}),
		);
		const asGuest = (task: string) =>
			app.fetch(`/api/activity?id=${task}&space=${owner.person.id}`, { headers: guest.headers });
		const seen = await json<{ entries: ActivityEntry[] }>(asGuest(id));
		expect(seen.entries.map(entry => `${entry.actor.name} ${entry.action}: ${entry.summary}`)).toEqual(named);
		expect((await asGuest(hidden)).status).toBe(404);
	});
});
