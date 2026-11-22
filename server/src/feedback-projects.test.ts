import { beforeAll, describe, expect, test } from 'bun:test';
import type { FeedbackProjects } from '../../shared/api/contract';
import type { Person } from '../../shared/sharing';
import { json, type Session, signUp, testApp, type TestApp, tokenHeaders } from './test-app';

let app: TestApp;
let stefan: Session;
let alice: Session;
let aiToken: string;
let editableProjectId: string;

beforeAll(async () => {
	app = await testApp();
	stefan = await signUp(app, 'Stefan');
	alice = await signUp(app, 'Alice');

	const editable = await json<{ id: string }>(
		app.fetch('/api/projects', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({ name: 'Pandemic' }),
		}),
	);
	editableProjectId = editable.id;
	await json(
		app.fetch('/api/sections', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({ projectId: editable.id, name: 'Bugs' }),
		}),
	);

	const readOnly = await json<{ id: string }>(
		app.fetch('/api/projects', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({ name: 'ReadOnly' }),
		}),
	);
	await json(
		app.fetch('/api/projects', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({ name: 'Private' }),
		}),
	);

	await json(
		app.fetch('/api/shares', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({
				target: { kind: 'project', id: editable.id },
				audience: { kind: 'user', userId: alice.person.id, role: 'edit' },
			}),
		}),
	);
	await json(
		app.fetch('/api/shares', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({
				target: { kind: 'project', id: readOnly.id },
				audience: { kind: 'user', userId: alice.person.id, role: 'view' },
			}),
		}),
	);

	const aliceProject = await json<{ id: string }>(
		app.fetch('/api/projects', {
			method: 'POST',
			headers: alice.headers,
			body: JSON.stringify({ name: 'Alice Own' }),
		}),
	);
	await json(
		app.fetch('/api/sections', {
			method: 'POST',
			headers: alice.headers,
			body: JSON.stringify({ projectId: aliceProject.id, name: 'Ideas' }),
		}),
	);

	const ai = await json<Person>(
		app.fetch('/api/ai', { method: 'POST', headers: stefan.headers, body: JSON.stringify({ name: 'Butler' }) }),
	);
	({ token: aiToken } = await json<{ token: string }>(
		app.fetch('/api/ai-tokens', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({ aiUserId: ai.id, name: 'bot' }),
		}),
	));
});

describe('/api/feedback/projects', () => {
	test('lists own projects and edit-shared projects from other spaces, never view-only shares or private projects', async () => {
		const res = await json<FeedbackProjects>(app.fetch('/api/feedback/projects', { headers: alice.headers }));
		expect(res.user.id).toBe(alice.person.id);
		expect(
			res.projects.map(project => ({
				name: project.name,
				owner: project.owner?.id ?? null,
				sections: project.sections.map(section => section.name),
			})),
		).toEqual([
			{ name: 'Alice Own', owner: null, sections: ['Ideas'] },
			{ name: 'Pandemic', owner: stefan.person.id, sections: ['Bugs'] },
		]);
		expect((await app.fetch('/api/feedback/projects', { headers: tokenHeaders(aiToken) })).status).toBe(403);
		expect((await app.fetch('/api/feedback/projects')).status).toBe(401);
	});

	test('filters projects to one space when space is given', async () => {
		const sharedOnly = await json<FeedbackProjects>(
			app.fetch(`/api/feedback/projects?space=${encodeURIComponent(stefan.person.id)}`, { headers: alice.headers }),
		);
		expect(sharedOnly.projects.map(project => project.id)).toEqual([editableProjectId]);

		const ownOnly = await json<FeedbackProjects>(
			app.fetch(`/api/feedback/projects?space=${encodeURIComponent(alice.person.id)}`, { headers: alice.headers }),
		);
		expect(ownOnly.projects.map(project => project.name)).toEqual(['Alice Own']);
	});
});
