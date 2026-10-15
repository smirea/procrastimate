import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Person } from '../../shared/sharing';
import type { Task } from '../../shared/sync/protocol';
import { memoryAccount } from './account/account';
import { authHeaders, registerDevice, TEST_AUTH_SECRET, type DeviceCredentials } from './account/test-device';
import { SHARED_ROUTES } from './actor';
import api from './api';
import type { Env } from './bindings';
import { agentExamples, agentRoutes, examplePath, TASK_ID } from './docs';

const ORIGIN = 'https://procrastimate.test';

beforeEach(() => setSystemTime(Date.UTC(2026, 9, 14, 18)));
afterEach(() => setSystemTime());

describe('agent docs', () => {
	let env: Env;
	let owner: DeviceCredentials;
	let token: string;
	let prompt: string;

	const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
		api.fetch(
			new Request(`${ORIGIN}${path}`, {
				method,
				headers: { 'content-type': 'application/json', ...headers },
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
			env,
		);
	const asAi = (method: string, path: string, body?: unknown) =>
		call(method, path, { Authorization: `Bearer ${token}` }, body);

	beforeEach(async () => {
		env = { ACCOUNT: memoryAccount(), BETTER_AUTH_SECRET: TEST_AUTH_SECRET };
		owner = await registerDevice(env, 'Owner Mac');
		const ai = (await (await call('POST', '/api/ai', authHeaders(owner), { name: 'Butler' })).json()) as Person;
		const created = await call('POST', '/api/ai-tokens', authHeaders(owner), { aiUserId: ai.id, name: 'laptop' });
		({ token, prompt } = (await created.json()) as { token: string; prompt: string });
	});

	test('the entry point is public and tells an agent how to get in', async () => {
		const response = await call('GET', '/api/docs');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
		const text = await response.text();
		expect(text).toStartWith('# ProcrastiMate\n');
		expect(text).toContain('Authorization: Bearer pm.<ownerId>.<secret>');
		expect(text).toContain(`GET ${ORIGIN}/api/docs/agent`);
	});

	test('the reference needs a valid token', async () => {
		expect((await call('GET', '/api/docs/agent')).status).toBe(401);
		expect((await call('GET', '/api/docs/openapi')).status).toBe(401);
		const forged = { Authorization: `Bearer ${token.slice(0, -2)}xx` };
		expect((await call('GET', '/api/docs/agent', forged)).status).toBe(401);
	});

	test('the reference covers exactly the routes an AI token may call', async () => {
		const routes = [
			'POST /api/sync',
			'GET /api/view',
			'POST /api/tasks',
			'PATCH /api/tasks',
			'DELETE /api/tasks',
			'POST /api/tasks/complete',
			'POST /api/tasks/reopen',
			'GET /api/activity',
		];
		expect([...SHARED_ROUTES].toSorted()).toEqual(routes.toSorted());

		const guide = await asAi('GET', '/api/docs/agent');
		expect(guide.status).toBe(200);
		const text = await guide.text();
		const tableRows = text
			.split('\n')
			.filter(line => /^\| (GET|POST|PATCH|DELETE) \|/.test(line))
			.map(line => line.split(' | ').slice(0, 2).join(' ').replace(/^\| /, '').replaceAll('`', ''));
		expect(tableRows).toEqual(routes);
		expect(text).toContain('| POST | `/api/tasks` | Add a task. `text` reads like the app’s quick add');
		expect(text).toContain('cannot create, rename, or delete projects or labels');

		const openApi = await asAi('GET', '/api/docs/openapi');
		expect(openApi.headers.get('content-type')).toBe('application/json; charset=utf-8');
		const document = (await openApi.json()) as { servers: unknown; paths: Record<string, object> };
		expect(document.servers).toEqual([{ url: ORIGIN }]);
		const documented = Object.entries(document.paths).flatMap(([path, methods]) =>
			Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`),
		);
		expect(documented).toEqual(routes);
	});

	test('every route has an example, and every example works with an AI token', async () => {
		const exampled = new Set(agentExamples.map(example => `${example.method} ${example.path}`));
		expect(agentRoutes.filter(route => !exampled.has(`${route.method} ${route.path}`))).toEqual([]);

		const target = (await (await asAi('POST', '/api/tasks', { title: 'Fix the sink' })).json()) as Task;
		const fill = (value: unknown) => JSON.parse(JSON.stringify(value ?? null).replaceAll(TASK_ID, target.id));
		const statuses = [];
		for (const example of agentExamples) {
			const path = examplePath(example).replaceAll(TASK_ID, target.id);
			const response = await asAi(example.method, path, example.body === undefined ? undefined : fill(example.body));
			statuses.push(`${response.status} ${example.title}`);
		}
		expect(statuses).toEqual(agentExamples.map(example => `200 ${example.title}`));
	});

	test('a new token comes with a prompt that carries it and points at the guide', () => {
		expect(prompt).toContain(`Authorization: Bearer ${token}`);
		expect(prompt).toContain(`${ORIGIN}/api/docs/agent`);
	});
});
