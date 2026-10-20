import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { ActivityEntry, ShareView } from '../../shared/sharing';
import { COALESCE_WINDOW } from './activity';
import { aiAccount, json, type Session, shareWith, signUp, taskRow, testApp, type TestApp, upload } from './test-app';

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
		await shareWith(app, owner, { kind: 'task', id }, guest.person.id, 'edit');
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

	test('a comment its author deleted is no longer quoted', async () => {
		const id = crypto.randomUUID();
		await upload(app, owner, [{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Plan') }]);
		const [kept, removed] = [crypto.randomUUID(), crypto.randomUUID()];
		const comment = (commentId: string, body: string) => ({
			op: 'put',
			table: 'comments',
			id: commentId,
			values: {
				id: commentId,
				user_id: owner.person.id,
				task_id: id,
				body,
				author_id: null,
				created_at: 1,
				edited_at: null,
			},
		});
		await upload(app, owner, [comment(kept, 'Booked'), comment(removed, 'Call me at 555-0100')]);
		await upload(app, owner, [{ op: 'delete', table: 'comments', id: removed }]);
		expect(await activity(id)).toEqual(['Owner created: added this task', 'Owner commented: commented “Booked”']);
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

	test('a delete and a re-put read as deleted and restored, and a stranger gets 403', async () => {
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

	test('an edit names the project, section, label, and parent it points at, and a guest only the ones it sees', async () => {
		const [errands, secret, shelf, vault, home, hidden, trip, id] = Array.from({ length: 8 }, () =>
			crypto.randomUUID(),
		);
		const named = (table: string, rowId: string, name: string, extra: Record<string, unknown> = {}) => ({
			op: 'put',
			table,
			id: rowId,
			values: { id: rowId, user_id: owner.person.id, name, created_at: 1, ...extra },
		});
		await upload(app, owner, [
			named('projects', errands, 'Errands'),
			named('projects', secret, 'Secret'),
			named('sections', shelf, 'Shelf', { project_id: errands }),
			named('sections', vault, 'Vault', { project_id: secret }),
			named('labels', home, 'home'),
			named('labels', hidden, 'private'),
			{ op: 'put', table: 'tasks', id: trip, values: taskRow(trip, owner.person.id, 'Trip', { projectId: errands }) },
			{ op: 'put', table: 'tasks', id, values: taskRow(id, owner.person.id, 'Pack') },
		]);
		const step = async (n: number, values: Record<string, unknown>) => {
			later(n * (COALESCE_WINDOW + 1000));
			expect(await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values }])).toEqual([]);
		};
		await step(1, { project_id: secret, section_id: vault });
		await step(2, { project_id: errands, section_id: shelf });
		await step(3, { section_id: null });
		await step(4, { label_ids: JSON.stringify([home, hidden]) });
		await step(5, { label_ids: JSON.stringify([home]) });
		await step(6, { parent_id: trip });
		expect(await activity(id)).toEqual([
			'Owner created: added this task',
			'Owner edited: moved it to Secret and put it in section Vault',
			'Owner edited: moved it to Errands and put it in section Shelf',
			'Owner edited: took it out of its section',
			'Owner edited: added labels home and private',
			'Owner edited: removed label private',
			'Owner edited: made it a subtask of “Trip”',
		]);
		const seen = [
			'Owner created: added this task',
			'Owner edited: moved it to another project and put it in a section',
			'Owner edited: moved it to Errands and put it in section Shelf',
			'Owner edited: took it out of its section',
			'Owner edited: added labels home and another label',
			'Owner edited: removed a label',
			'Owner edited: made it a subtask',
		];
		const share = (userId: string) => shareWith(app, owner, { kind: 'task', id }, userId, 'view');
		await share(guest.person.id);
		const read = async (headers: Record<string, string>, task: string) =>
			app.fetch(`/api/activity?id=${task}&space=${owner.person.id}`, { headers });
		const entries = async (headers: Record<string, string>) =>
			(await json<{ entries: ActivityEntry[] }>(read(headers, id))).entries.map(
				entry => `${entry.actor.name} ${entry.action}: ${entry.summary}`,
			);
		expect(await entries(guest.headers)).toEqual(seen);
		expect((await read(guest.headers, trip)).status).toBe(404);

		const { person: ai, headers: asAi } = await aiAccount(app, owner, 'Narrow');
		const { shares } = await json<{ shares: ShareView[] }>(app.fetch('/api/shares', { headers: owner.headers }));
		const whole = shares.find(row => row.grantee?.id === ai.id && row.target.kind === 'space')!;
		await app.fetch(`/api/shares?id=${whole.id}`, { method: 'DELETE', headers: owner.headers });
		await share(ai.id);
		expect(await entries(asAi)).toEqual(seen);
	});
});
