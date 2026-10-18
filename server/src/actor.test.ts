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

		await app.db.execute(sql`DELETE FROM "session" WHERE "userId" = ${me.person.id}`);
		expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);

		await app.fetch('/api/auth/sign-out', { method: 'POST', headers: me.headers, body: '{}' });
		expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(401);
	});
});
