import { expect, test } from 'bun:test';
import { createClient } from '@libsql/client/web';
import { sql } from 'drizzle-orm';
import { authOnDatabase } from './better-auth';
import { localTurso } from './db/test-turso';
import { openDatabase } from './db/turso';

const post = (auth: { handler: (request: Request) => Promise<Response> }, path: string, body: object) =>
	auth.handler(
		new Request(`https://procrastimate.test${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://procrastimate.test' },
			body: JSON.stringify(body),
		}),
	);

test('sign-up runs inside a transaction', async () => {
	let transactions = 0;
	const db = await localTurso({ onTransaction: () => (transactions += 1) });
	const auth = authOnDatabase('transaction-test-secret-0123456789', db);
	const response = await post(auth, '/api/auth/sign-up/email', {
		email: 'tx@procrastimate.test',
		password: 'test-password-1',
		name: 'Tx',
	});
	expect(response.status).toBe(200);
	expect(transactions).toBeGreaterThan(0);
	const [row] = await db.all<{ email: string; createdAt: number }>(sql`select email, createdAt from user`);
	expect(row?.email).toBe('tx@procrastimate.test');
	expect(row?.createdAt).toBeGreaterThan(0);
});

test('rate limits stay in the database across auth instances', async () => {
	const db = await localTurso();
	const secret = 'rate-limit-test-secret-0123456789';
	const body = { email: 'limit@procrastimate.test', password: 'test-password-1', name: 'Limit' };
	const first = authOnDatabase(secret, db);
	expect((await post(first, '/api/auth/sign-up/email', body)).status).toBe(200);
	const signIn = (auth: typeof first) => post(auth, '/api/auth/sign-in/email', body);
	expect((await signIn(first)).status).toBe(200);
	expect((await signIn(first)).status).toBe(200);
	expect((await signIn(first)).status).toBe(200);
	expect((await signIn(first)).status).toBe(429);
	expect((await signIn(authOnDatabase(secret, db))).status).toBe(429);
	const [row] = await db.all<{ n: number }>(sql`select count(*) as n from rateLimit`);
	expect(row?.n).toBeGreaterThan(0);
});

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

test.skipIf(!tursoUrl || !tursoToken)('sign-up commits on the configured Turso database', async () => {
	const db = await openDatabase(createClient({ url: tursoUrl!, authToken: tursoToken! }));
	const email = `tx-${crypto.randomUUID()}@procrastimate.test`;
	const response = await post(authOnDatabase('transaction-test-secret-0123456789', db), '/api/auth/sign-up/email', {
		email,
		password: 'test-password-1',
		name: 'Tx',
	});
	expect(response.status).toBe(200);
	const id = ((await response.json()) as { user: { id: string } }).user.id;
	await db.run(sql`delete from session where userId = ${id}`);
	await db.run(sql`delete from account where userId = ${id}`);
	await db.run(sql`delete from user where id = ${id}`);
});
