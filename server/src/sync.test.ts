import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { aiAccount, json, ORIGIN, type Session, signUp, testApp, type TestApp } from './test-app';
import { TOKEN_SECONDS } from './sync';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});
afterAll(() => app.close());

const claims = (token: string) =>
	token
		.split('.')
		.slice(0, 2)
		.map(part => JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>);

describe('GET /api/sync/token', () => {
	test('signs an EdDSA token for the user and names the proxy on the request’s own origin, without an Origin header', async () => {
		const { origin: _, ...headers } = owner.headers;
		const { token, endpoint } = await json<{ token: string; endpoint: string }>(
			app.fetch('/api/sync/token', { headers }),
		);
		expect(endpoint).toBe(`${ORIGIN}/api/powersync`);
		const [header, payload] = claims(token);
		expect(header).toMatchObject({ alg: 'EdDSA', typ: 'JWT', kid: 'insecure-local-dev-5d7cc3c8' });
		expect(payload).toMatchObject({ sub: owner.person.id, aud: 'powersync' });
		expect(Number(payload!.exp) - Number(payload!.iat)).toBe(TOKEN_SECONDS);
	});

	test('the proxy only ever reaches the configured PowerSync origin, whatever the path says', async () => {
		const hits: string[] = [];
		const upstream = Bun.serve({
			port: 0,
			fetch: request => {
				hits.push(`upstream ${new URL(request.url).pathname}`);
				return new Response('powersync');
			},
		});
		const evil = Bun.serve({
			port: 0,
			fetch: request => {
				hits.push(`evil ${new URL(request.url).pathname}`);
				return new Response('<script>alert(1)</script>', { headers: { 'content-type': 'text/html' } });
			},
		});
		const proxied = await testApp({ env: { POWERSYNC_URL: `http://127.0.0.1:${upstream.port}` } });
		try {
			const response = await proxied.fetch(`/api/powersync//127.0.0.1:${evil.port}/x`);
			expect(await response.text()).toBe('powersync');
			expect(hits.map(hit => hit.split(' ')[0])).toEqual(['upstream']);
			hits.length = 0;
			await proxied.fetch('/api/powersync/sync/stream?x=1');
			expect(hits).toEqual(['upstream /sync/stream']);
		} finally {
			await proxied.close();
			upstream.stop(true);
			evil.stop(true);
		}
	});

	test('an AI account gets no token', async () => {
		const { token } = await aiAccount(app, owner);
		expect((await app.fetch('/api/sync/token', { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
		expect((await app.fetch('/api/sync/token')).status).toBe(401);
	});
});
