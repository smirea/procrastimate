import { beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { aiAccount, signUp, testApp, type TestApp } from './test-app';

let app: TestApp;
beforeAll(async () => {
	app = await testApp();
});

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

	test("a bearer stays trusted across the sync engine's one-minute pulls, and is read again after five minutes", async () => {
		const me = await signUp(app, 'Puller');
		const start = Date.now();
		try {
			expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);
			setSystemTime(start + 61_000);
			app.statements.length = 0;
			expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);
			expect(app.statements.filter(statement => statement.includes('"session"'))).toEqual([]);
			setSystemTime(start + 5 * 60_000 + 1_000);
			app.statements.length = 0;
			expect((await app.fetch('/api/me', { headers: me.headers })).status).toBe(200);
			expect(app.statements.some(statement => statement.includes('"session"'))).toBe(true);
		} finally {
			setSystemTime();
		}
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

describe('human-only routes', () => {
	test('an AI account is refused where the contract says FORBIDDEN, and its owner is not', async () => {
		const owner = await signUp(app, 'Botowner');
		const { headers } = await aiAccount(app, owner);
		for (const path of [
			'/api/me',
			'/api/people?q=a',
			'/api/sync/token',
			'/api/push/schedule',
			'/api/ai',
			'/api/ai-tokens',
		]) {
			expect([path, (await app.fetch(path, { headers })).status]).toEqual([path, 403]);
			expect((await app.fetch(path, { headers: owner.headers })).status).not.toBe(403);
		}
	});
});
