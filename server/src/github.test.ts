import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { type Session, signUp, testApp, type TestApp } from './test-app';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp({ env: { GITHUB_TOKEN: 'ghp_test' } });
	owner = await signUp(app, 'Owner');
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const API = 'https://api.github.com/repos/smirea/procrastimate/issues';
const PAGE = 'https://github.com/smirea/procrastimate';

/** Stands in for GitHub: each URL answers its response, anything else a 404, and every request's auth is logged. */
function github(pages: Record<string, () => Response>): { url: string; auth: string | null }[] {
	const asked: { url: string; auth: string | null }[] = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		asked.push({ url, auth: new Headers(init?.headers).get('authorization') });
		return pages[url]?.() ?? new Response('missing', { status: 404 });
	}) as typeof fetch;
	return asked;
}

const read = (url: string, session: Session | null = owner) =>
	app.fetch(`/api/github?url=${encodeURIComponent(url)}`, { headers: session?.headers ?? {} });

describe('GET /api/github', () => {
	test.each([
		[
			'a merged pull request',
			{ state: 'closed', pull_request: { merged_at: '2026-11-01T00:00:00Z' } },
			'merged',
			'pull',
		],
		['a draft pull request', { state: 'open', draft: true, pull_request: { merged_at: null } }, 'draft', 'pull'],
		['a closed pull request', { state: 'closed', draft: false, pull_request: { merged_at: null } }, 'closed', 'pull'],
		['an open issue', { state: 'open' }, 'open', 'issue'],
		['a closed issue', { state: 'closed', state_reason: 'completed' }, 'closed', 'issue'],
	])('reads %s from the API with the token', async (_, body, state, kind) => {
		const asked = github({ [`${API}/309`]: () => Response.json({ title: ' Fix sync ', ...body }) });
		expect(await (await read(`${PAGE}/pull/309`)).json()).toEqual({ title: 'Fix sync', state, kind });
		expect(asked).toEqual([{ url: `${API}/309`, auth: 'Bearer ghp_test' }]);
	});

	test('an issue link to a pull request reads as the pull request', async () => {
		github({ [`${API}/7`]: () => Response.json({ title: 'Ship', state: 'open', pull_request: { merged_at: null } }) });
		expect(await (await read('smirea/procrastimate#7')).json()).toEqual({ title: 'Ship', state: 'open', kind: 'pull' });
	});

	test('falls back to the page title with no state when the API refuses', async () => {
		github({
			[`${API}/309`]: () => new Response('rate limited', { status: 403 }),
			[`${PAGE}/pull/309`]: () =>
				new Response('<title>Fix sync by smirea · Pull Request #309 · smirea/procrastimate · GitHub</title>', {
					headers: { 'content-type': 'text/html' },
				}),
		});
		expect(await (await read(`${PAGE}/pull/309/files`)).json()).toEqual({
			title: 'Fix sync',
			state: null,
			kind: 'pull',
		});
	});

	test('answers nulls when neither can be read, as for a private repo without a token', async () => {
		github({});
		expect(await (await read(`${PAGE}/issues/3`)).json()).toEqual({ title: null, state: null, kind: 'issue' });
	});

	test('refuses what is not an issue or pull request, and needs a session', async () => {
		expect((await read('https://github.com/smirea')).status).toBe(400);
		expect((await read(`${PAGE}/pull/1`, null)).status).toBe(401);
	});
});

describe('GET /api/link-preview for GitHub', () => {
	test("titles a pasted pull request from GitHub's API", async () => {
		github({ [`${API}/309`]: () => Response.json({ title: 'Fix sync', state: 'open', pull_request: {} }) });
		const response = await app.fetch(`/api/link-preview?url=${encodeURIComponent(`${PAGE}/pull/309`)}`, {
			headers: owner.headers,
		});
		expect(await response.json()).toEqual({ title: 'Fix sync' });
	});
});
