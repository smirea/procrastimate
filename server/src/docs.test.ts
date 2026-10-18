import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Person } from '../../shared/sharing';
import type { Task } from '../../shared/model';
import {
	agentExamples,
	agentRoutes,
	COMMENT_ID,
	examplePath,
	IMAGE_ID,
	LABEL_ID,
	LINK_ID,
	PLACE_ID,
	PROJECT_ID,
	SECTION_ID,
	TASK_ID,
} from './docs';
import { json, ORIGIN, signUp, testApp, tokenHeaders, type Session, type TestApp } from './test-app';

beforeEach(() => setSystemTime(Date.UTC(2026, 9, 14, 18)));
afterEach(() => setSystemTime());

describe('agent docs', () => {
	let app: TestApp;
	let owner: Session;
	let token: string;
	let prompt: string;

	const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
		app.fetch(path, {
			method,
			headers: { 'content-type': 'application/json', ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	const asAi = (method: string, path: string, body?: unknown) => call(method, path, tokenHeaders(token), body);

	beforeAll(async () => {
		app = await testApp();
		owner = await signUp(app, 'Owner');
		const ai = await json<Person>(call('POST', '/api/ai', owner.headers, { name: 'Butler' }));
		({ token, prompt } = await json<{ token: string; prompt: string }>(
			call('POST', '/api/ai-tokens', owner.headers, { aiUserId: ai.id, name: 'laptop' }),
		));
	});
	afterAll(() => app.close());

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
		const forged = { authorization: `Bearer ${token.slice(0, -2)}xx` };
		expect((await call('GET', '/api/docs/agent', forged)).status).toBe(401);
	});

	test('the reference covers exactly the routes an AI token may call', async () => {
		const routes = [
			'GET /api/view',
			'POST /api/tasks',
			'PATCH /api/tasks',
			'DELETE /api/tasks',
			'POST /api/tasks/complete',
			'POST /api/tasks/reopen',
			'GET /api/activity',
			'GET /api/comments',
			'POST /api/comments',
			'PATCH /api/comments',
			'DELETE /api/comments',
			'POST /api/projects',
			'PATCH /api/projects',
			'DELETE /api/projects',
			'POST /api/sections',
			'PATCH /api/sections',
			'DELETE /api/sections',
			'POST /api/labels',
			'PATCH /api/labels',
			'DELETE /api/labels',
			'GET /api/links',
			'POST /api/links',
			'DELETE /api/links',
			'GET /api/images',
		];
		expect(agentRoutes.map(route => `${route.method} ${route.path}`).toSorted()).toEqual(routes.toSorted());

		const guide = await asAi('GET', '/api/docs/agent');
		expect(guide.status).toBe(200);
		const text = await guide.text();
		const tableRows = text
			.split('\n')
			.filter(line => /^\| (GET|POST|PATCH|DELETE) \|/.test(line))
			.map(line => line.split(' | ').slice(0, 2).join(' ').replace(/^\| /, '').replaceAll('`', ''));
		expect(tableRows).toEqual(routes);
		expect(text).toContain('| POST | `/api/tasks` | Add a task. `text` reads like the app’s quick add');
		expect(text).toContain('| POST | `/api/links` | Publish a task, project, or label as a read-only link.');

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

		const target = await json<Task>(asAi('POST', '/api/tasks', { title: 'Fix the sink' }));
		const comment = await json<{ id: string }>(asAi('POST', '/api/comments', { taskId: target.id, body: 'On it' }));
		const image = crypto.randomUUID();
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
		for (const size of ['full', 'thumb']) {
			const uploaded = await app.fetch(`/api/images?id=${image}&size=${size}`, {
				method: 'PUT',
				headers: { ...owner.headers, 'content-type': 'image/jpeg' },
				body: jpeg,
			});
			expect(uploaded.status).toBe(200);
		}
		await asAi('PATCH', `/api/tasks?id=${target.id}`, { images: [{ id: image, width: 4, height: 3 }] });
		const made = async (path: string, body: unknown) => (await json<{ id: string }>(asAi('POST', path, body))).id;
		const projectId = await made('/api/projects', { name: 'Chores' });
		const sectionId = await made('/api/sections', { projectId, name: 'Later' });
		const labelId = await made('/api/labels', { name: 'someday' });
		const place = { address: null, latitude: 52.5, longitude: 13.4, radius: 80 };
		const placeId = await made('/api/labels', { name: 'office', place });
		const linkId = await made('/api/links', { target: { kind: 'project', id: projectId } });
		const ids = (text: string) =>
			text
				.replaceAll(TASK_ID, target.id)
				.replaceAll(COMMENT_ID, comment.id)
				.replaceAll(IMAGE_ID, image)
				.replaceAll(PROJECT_ID, projectId)
				.replaceAll(SECTION_ID, sectionId)
				.replaceAll(LABEL_ID, labelId)
				.replaceAll(PLACE_ID, placeId)
				.replaceAll(LINK_ID, linkId);
		const fill = (value: unknown) => JSON.parse(ids(JSON.stringify(value ?? null)));
		const statuses = [];
		for (const example of agentExamples) {
			const path = ids(examplePath(example));
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
