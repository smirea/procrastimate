import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { Person } from '../../shared/sharing';
import { FEEDBACK_REPO } from './feedback-issues';
import { json, type Session, signUp, testApp, type TestApp, tokenHeaders } from './test-app';

let app: TestApp;
let stefan: Session;
let guest: Session;
let aiToken: string;

beforeAll(async () => {
	app = await testApp({ env: { FEEDBACK_GITHUB_TOKEN: 'gho_feedback', FEEDBACK_GITHUB_USER_ID: 'set-below' } });
	stefan = await signUp(app, 'Stefan');
	guest = await signUp(app, 'Guest');
	app.config.feedbackGithub = { token: 'gho_feedback', userId: stefan.person.id };
	const ai = await json<Person>(
		app.fetch('/api/ai', { method: 'POST', headers: stefan.headers, body: JSON.stringify({ name: 'Butler' }) }),
	);
	({ token: aiToken } = await json<{ token: string }>(
		app.fetch('/api/ai-tokens', {
			method: 'POST',
			headers: stefan.headers,
			body: JSON.stringify({ aiUserId: ai.id, name: 'laptop' }),
		}),
	));
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const API = `https://api.github.com/repos/${FEEDBACK_REPO}`;
const ASSET = 'https://github.com/user-attachments/assets/abc';

type Asked = { method: string; url: string; auth: string | null; body: string };

/** Stands in for GitHub, answering the repository, the upload, the issue, and its comments. */
function github(fail?: string): Asked[] {
	const asked: Asked[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		const method = init?.method ?? 'GET';
		const body = typeof init?.body === 'string' ? init.body : '';
		asked.push({ method, url, auth: new Headers(init?.headers).get('authorization'), body });
		if (fail && url.startsWith(fail)) return new Response('Bad credentials', { status: 401 });
		if (url === API) return Response.json({ id: 42 });
		if (url.startsWith('https://uploads.github.com/user-attachments/assets?')) return Response.json({ url: ASSET });
		if (url === `${API}/issues`)
			return Response.json({ number: 7, html_url: `https://github.com/${FEEDBACK_REPO}/issues/7` });
		if (url === `${API}/issues/7/comments`) return Response.json({});
		return new Response('missing', { status: 404 });
	}) as typeof fetch;
	return asked;
}

const report = (text: string) =>
	JSON.stringify({
		environment: [{ name: 'App', value: 'ProcrastiMate 1.0' }],
		items: [{ number: 1, title: 'TaskRow', code: 'App/TaskRow.swift:12', text }],
	});

/** The request feedback-engine's webhook sends. */
function post(headers: Record<string, string>, text = 'Row is too tall') {
	const form = new FormData();
	form.set('id', 'post-1');
	form.set('title', 'Inbox Feedback: 1 change');
	form.set('image', new File([new Uint8Array([137, 80, 78, 71])], 'feedback.png', { type: 'image/png' }));
	form.set('report', new File([report(text)], 'feedback.json', { type: 'application/json' }));
	const { 'content-type': _, ...rest } = headers;
	return app.fetch('/api/feedback/issues', { method: 'POST', headers: rest, body: form });
}

const enabled = async (headers: Record<string, string>) =>
	(await json<{ enabled: boolean }>(app.fetch('/api/feedback/github', { headers }))).enabled;

describe('feedback as GitHub issues', () => {
	test('only Stefan’s account gets the Share entry', async () => {
		expect(await enabled(stefan.headers)).toBe(true);
		expect(await enabled(guest.headers)).toBe(false);
		expect((await app.fetch('/api/feedback/github', { headers: tokenHeaders(aiToken) })).status).toBe(403);
		expect((await app.fetch('/api/feedback/github')).status).toBe(401);
	});

	test('Stefan’s post files an issue with the screenshot, the items, and the report, as the token’s account', async () => {
		const asked = github();
		const response = await post(stefan.headers);
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ url: `https://github.com/${FEEDBACK_REPO}/issues/7` });
		expect(asked.map(({ method, url }) => `${method} ${url.split('?')[0]}`)).toEqual([
			`GET ${API}`,
			'POST https://uploads.github.com/user-attachments/assets',
			`POST ${API}/issues`,
		]);
		expect(asked.every(request => request.auth === 'Bearer gho_feedback')).toBe(true);
		expect(asked[1]!.url).toContain('repository_id=42');
		const issue = JSON.parse(asked[2]!.body) as { title: string; body: string; labels: string[] };
		expect(issue.title).toBe('Inbox Feedback: 1 change');
		expect(issue.labels).toEqual(['feedback']);
		expect(issue.body).toStartWith(`![Inbox Feedback: 1 change](${ASSET})`);
		expect(issue.body).toContain('**1. TaskRow** · `App/TaskRow.swift:12`\n\n> Row is too tall');
		expect(issue.body).toContain('<summary>feedback.json</summary>');
	});

	test('every other caller is refused before GitHub hears of it', async () => {
		const asked = github();
		const refused = await post(guest.headers);
		expect(refused.status).toBe(403);
		expect(((await refused.json()) as { message: string }).message).toBe(
			'GitHub issues are filed from Stefan’s account only.',
		);
		expect((await post(tokenHeaders(aiToken))).status).toBe(403);
		expect((await post({})).status).toBe(401);
		expect(asked).toEqual([]);
	});

	test('GitHub’s refusal reaches the editor as the message', async () => {
		github('https://uploads.github.com/');
		const response = await post(stefan.headers);
		expect(response.status).toBe(502);
		expect(((await response.json()) as { message: string }).message).toStartWith(
			'GitHub answered 401 to POST /user-attachments/assets',
		);
	});

	test('a report too long for the issue goes into comments that join back into the file', async () => {
		const asked = github();
		const text = 'x'.repeat(70_000);
		expect((await post(stefan.headers, text)).status).toBe(201);
		const issue = JSON.parse(asked[2]!.body) as { body: string };
		expect(issue.body.length).toBeLessThanOrEqual(65_000);
		expect(issue.body).toEndWith('`feedback.json` in the comments has every item in full.');
		const comments = asked.slice(3).map(request => (JSON.parse(request.body) as { body: string }).body);
		expect(comments.length).toBe(2);
		const joined = comments.map(comment => /```json\n([\s\S]*)\n```/.exec(comment)![1]).join('');
		expect(joined).toBe(report(text));
	});

	test('a server without the token answers 503', async () => {
		const bare = await testApp();
		const someone = await signUp(bare, 'Stefan');
		expect(await json<{ enabled: boolean }>(bare.fetch('/api/feedback/github', { headers: someone.headers }))).toEqual({
			enabled: false,
		});
		const { 'content-type': _, ...headers } = someone.headers;
		const form = new FormData();
		form.set('id', 'x');
		form.set('title', 't');
		form.set('image', new File(['i'], 'feedback.png'));
		form.set('report', new File(['{}'], 'feedback.json'));
		expect((await bare.fetch('/api/feedback/issues', { method: 'POST', headers, body: form })).status).toBe(503);
	});
});
