import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentTask } from '../../shared/sharing';
import type { CreatedWebhook, WebhookDelivery } from '../../shared/webhooks';
import { aiAccount, json, signUp, taskRow, testApp, upload, type Session, type TestApp } from './test-app';
import { DISABLE_AFTER_MS, deliverWebhooks, type SendWebhook } from './webhooks';

const RECEIVER = 'https://hooks.example/wake';

let app: TestApp;
let owner: Session;
let bot: Awaited<ReturnType<typeof aiAccount>>;
let watched: string;
let other: string;

type Sent = { url: string; body: WebhookDelivery; signature: string };
let sent: Sent[];
let status: number | null;
const receiver: SendWebhook = async (url, body, headers) => {
	sent.push({ url, body: JSON.parse(body), signature: headers['x-procrastimate-signature']! });
	return status;
};
const cron = (at = Date.now()) => deliverWebhooks(app.db, at, receiver);

const post = <T>(session: { headers: Record<string, string> }, path: string, body: unknown) =>
	json<T>(app.fetch(path, { method: 'POST', headers: session.headers, body: JSON.stringify(body) }));
const addTask = (session: { headers: Record<string, string> }, title: string, projectId: string | null) =>
	post<AgentTask>(session, '/api/tasks', { title, projectId });
const comment = (session: { headers: Record<string, string> }, taskId: string, body: string) =>
	post<{ id: string }>(session, '/api/comments', { taskId, body });
const register = (body: unknown) => post<CreatedWebhook>(bot, '/api/webhooks', body);
const summaries = () => sent.map(delivery => delivery.body.summary);

async function hmac(secret: string, body: string) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
	return `sha256=${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
	bot = await aiAccount(app, owner, 'Orchestrator');
	watched = (await post<{ id: string }>(bot, '/api/projects', { name: 'app' })).id;
	other = (await post<{ id: string }>(bot, '/api/projects', { name: 'home' })).id;
});
beforeEach(() => {
	sent = [];
	status = 202;
});

describe('webhooks', () => {
	test('a human’s task and comment in the watched project wake the hook once, signed; the bot’s own never do', async () => {
		const before = await addTask(owner, 'Written before the hook', watched);
		const hook = await register({ url: RECEIVER, projectIds: [watched] });
		expect(hook.secret).toMatch(/^[0-9a-f]{64}$/);

		const mine = await addTask(bot, 'Filed by the bot', watched);
		await comment(bot, mine.id, 'The bot talking to itself');
		await addTask(owner, 'Somewhere else', other);
		expect(await cron()).toBe(0);
		expect(sent).toEqual([]);

		const task = await addTask(owner, 'Fix the login screen', watched);
		const said = await comment(owner, before.id, 'Use the new icon');
		expect(await cron()).toBe(1);
		expect(sent).toHaveLength(1);
		const [delivery] = sent;
		expect(delivery!.url).toBe(RECEIVER);
		expect(delivery!.body.summary).toBe('1 task added, 1 comment added');
		expect(
			delivery!.body.events.map(({ type, taskId, commentId, projectId, actorId }) => ({
				type,
				taskId,
				commentId,
				projectId,
				actorId,
			})),
		).toEqual([
			{ type: 'task.added', taskId: task.id, commentId: null, projectId: watched, actorId: owner.person.id },
			{ type: 'comment.added', taskId: before.id, commentId: said.id, projectId: watched, actorId: owner.person.id },
		]);
		expect(delivery!.signature).toBe(await hmac(hook.secret, JSON.stringify(delivery!.body)));

		expect(await cron()).toBe(0);
		expect(sent).toHaveLength(1);
		await json(app.fetch(`/api/webhooks?id=${hook.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('a device’s sync counts, and so does a task a human moves into the watched project', async () => {
		const hook = await register({ url: RECEIVER, projectIds: [watched] });
		const id = crypto.randomUUID();
		await upload(app, owner, [
			{
				op: 'put',
				table: 'tasks',
				id,
				values: taskRow(id, owner.person.id, 'Typed on the phone', { projectId: other }),
			},
		]);
		await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values: { title: 'Typed on the phone, edited' } }]);
		expect(await cron()).toBe(0);

		await upload(app, owner, [{ op: 'patch', table: 'tasks', id, values: { project_id: watched } }]);
		expect(await cron()).toBe(1);
		expect(sent[0]!.body.events.map(event => [event.type, event.taskId])).toEqual([['task.added', id]]);
		await json(app.fetch(`/api/webhooks?id=${hook.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('a failed POST resends the same delivery each minute until one lands', async () => {
		const hook = await register({ url: RECEIVER });
		await addTask(owner, 'Survives an outage', null);
		status = 500;
		await cron();
		status = null;
		await cron();
		const [listed] = (
			await json<{ webhooks: { failingSince: number | null; lastError: string | null }[] }>(
				app.fetch('/api/webhooks', { headers: bot.headers }),
			)
		).webhooks;
		expect(listed!.lastError).toBe('No answer');
		expect(listed!.failingSince).not.toBeNull();

		status = 200;
		await addTask(owner, 'Added during the outage', null);
		await cron();
		await cron();
		const ids = sent.map(delivery => delivery.body.id);
		expect(ids.slice(0, 3)).toEqual([ids[0]!, ids[0]!, ids[0]!]);
		expect(ids[3]).not.toBe(ids[0]);
		expect(summaries()).toEqual(['1 task added', '1 task added', '1 task added', '1 task added']);
		const [healed] = (
			await json<{ webhooks: { failingSince: number | null; lastError: string | null }[] }>(
				app.fetch('/api/webhooks', { headers: bot.headers }),
			)
		).webhooks;
		expect(healed).toMatchObject({ failingSince: null, lastError: null });
		await json(app.fetch(`/api/webhooks?id=${hook.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('a retry keeps its id and events while other writes land, and an empty run clears the failure', async () => {
		const hook = await register({ url: RECEIVER });
		await addTask(owner, 'First', null);
		status = 500;
		await cron();
		const elsewhere = await signUp(app, 'Elsewhere');
		await addTask(elsewhere, 'Another space moves the log head', null);
		await addTask(owner, 'Arrives during the retry', null);
		await cron();
		expect(sent.map(delivery => delivery.body.id)).toEqual([sent[0]!.body.id, sent[0]!.body.id]);
		expect(summaries()).toEqual(['1 task added', '1 task added']);

		status = 202;
		await cron();
		await cron();
		expect(summaries()).toEqual(['1 task added', '1 task added', '1 task added', '1 task added']);
		expect(sent[3]!.body.id).not.toBe(sent[0]!.body.id);
		expect(sent[3]!.body.events[0]!.taskId).not.toBe(sent[0]!.body.events[0]!.taskId);

		status = 500;
		const doomed = await addTask(owner, 'Deleted before it lands', null);
		await cron();
		await json(app.fetch(`/api/tasks?id=${doomed.id}`, { method: 'DELETE', headers: owner.headers }));
		await cron();
		const [cleared] = (
			await json<{ webhooks: { failingSince: number | null; lastError: string | null }[] }>(
				app.fetch('/api/webhooks', { headers: bot.headers }),
			)
		).webhooks;
		expect(cleared).toMatchObject({ failingSince: null, lastError: null });
		await json(app.fetch(`/api/webhooks?id=${hook.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('moving a task with subtasks into the watched project is one addition', async () => {
		const hook = await register({ url: RECEIVER, projectIds: [watched] });
		const parent = await addTask(owner, 'Parent', other);
		await post(owner, '/api/tasks', { title: 'Child', parentId: parent.id });
		await cron();
		expect(sent).toEqual([]);
		await json(
			app.fetch(`/api/tasks?id=${parent.id}`, {
				method: 'PATCH',
				headers: owner.headers,
				body: JSON.stringify({ projectId: watched }),
			}),
		);
		await cron();
		expect(sent.map(delivery => delivery.body.events.map(event => event.taskId))).toEqual([[parent.id]]);
		await json(app.fetch(`/api/webhooks?id=${hook.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('deleting the AI account deletes the webhooks it registered', async () => {
		const temp = await aiAccount(app, owner, 'Temporary');
		await post(temp, '/api/webhooks', { url: 'https://hooks.example/temporary' });
		const mine = await register({ url: RECEIVER });
		const removed = await app.fetch(`/api/ai?id=${temp.person.id}`, { method: 'DELETE', headers: owner.headers });
		expect(removed.status).toBe(200);
		const left = await json<{ webhooks: { url: string }[] }>(app.fetch('/api/webhooks', { headers: bot.headers }));
		expect(left.webhooks.map(hook => hook.url)).toEqual([RECEIVER]);
		await json(app.fetch(`/api/webhooks?id=${mine.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('a 410 or a day of failures disables the hook; registering again resumes from now with the same secret', async () => {
		const hook = await register({ url: RECEIVER });
		await addTask(owner, 'Nobody listens', null);
		status = 410;
		await cron();
		await addTask(owner, 'Still nobody', null);
		await cron();
		expect(sent).toHaveLength(1);

		status = 202;
		const again = await register({ url: RECEIVER });
		expect(again).toMatchObject({ id: hook.id, secret: hook.secret, disabledAt: null, lastError: null });
		expect(await cron()).toBe(0);
		await addTask(owner, 'Back again', null);
		expect(await cron()).toBe(1);
		expect(summaries().at(-1)).toBe('1 task added');

		status = 503;
		const start = Date.now();
		await addTask(owner, 'Flaky receiver', null);
		await cron(start);
		await cron(start + DISABLE_AFTER_MS - 60_000);
		const [failing] = (
			await json<{ webhooks: { disabledAt: number | null }[] }>(app.fetch('/api/webhooks', { headers: bot.headers }))
		).webhooks;
		expect(failing!.disabledAt).toBeNull();
		await cron(start + DISABLE_AFTER_MS);
		const [disabled] = (
			await json<{ webhooks: { disabledAt: number | null }[] }>(app.fetch('/api/webhooks', { headers: bot.headers }))
		).webhooks;
		expect(disabled!.disabledAt).toBe(start + DISABLE_AFTER_MS);
		await json(app.fetch(`/api/webhooks?id=${hook.id}`, { method: 'DELETE', headers: bot.headers }));
	});

	test('registering checks the URL, the projects, and that the caller manages the space', async () => {
		const refused = (body: unknown, headers = bot.headers) =>
			app.fetch('/api/webhooks', { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.status);
		expect(await refused({ url: 'http://hooks.example/wake' })).toBe(400);
		expect(await refused({ url: RECEIVER, projectIds: ['no-such-project'] })).toBe(404);
		expect(await refused({ url: RECEIVER, projectIds: Array.from({ length: 51 }, (_, i) => `p${i}`) })).toBe(400);

		const stranger = await signUp(app, 'Stranger');
		expect(await refused({ url: RECEIVER }, stranger.headers)).toBe(200);
		const theirs = await json<{ webhooks: unknown[] }>(app.fetch('/api/webhooks', { headers: stranger.headers }));
		expect(theirs.webhooks).toHaveLength(1);
		const intruding = await app.fetch(`/api/webhooks?space=${owner.person.id}`, { headers: stranger.headers });
		expect(intruding.status).toBe(403);

		const local = await register({ url: 'http://127.0.0.1:3773/api/hooks/a/b' });
		expect(local.url).toBe('http://127.0.0.1:3773/api/hooks/a/b');
		await json(app.fetch(`/api/webhooks?id=${local.id}`, { method: 'DELETE', headers: bot.headers }));
	});
});
