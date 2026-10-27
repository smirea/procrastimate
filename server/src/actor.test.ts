import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { signUp, testApp, type TestApp } from './test-app';

let app: TestApp;
beforeAll(async () => {
	app = await testApp();
});
afterAll(() => app.close());

describe('the bearer session cache', () => {
	test('a resolved bearer is trusted for a minute without the session row, and sign-out drops it at once', async () => {
		const me = await signUp(app, 'Cached');
		expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);
		app.statements.length = 0;
		expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);
		expect(app.statements).toEqual([]);

		app.db.run(sql`DELETE FROM "session" WHERE "userId" = ${me.person.id}`);
		expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);

		await app.fetch('/api/auth/sign-out', { method: 'POST', headers: me.headers, body: '{}' });
		expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(401);
	});
});

describe('reading a session', () => {
	test('a database that cannot be read answers 5xx, not the 401 that signs the device out', async () => {
		const me = await signUp(app, 'Blipped');
		const select = app.db.select;
		(app.db as { select: unknown }).select = () => {
			throw new Error('connection reset');
		};
		try {
			const response = await app.fetch('/api/sync/token', { headers: me.headers });
			expect(response.status).toBe(500);
		} finally {
			app.db.select = select;
		}
		expect((await app.fetch('/api/sync/token', { headers: me.headers })).status).toBe(200);
	});
});
