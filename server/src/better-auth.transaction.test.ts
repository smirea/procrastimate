import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createClient, type Client } from '@libsql/client/web';
import { authOnClient } from './better-auth';

/**
 * A libSQL client whose `transaction()` counts BEGIN and COMMIT. Better Auth must use that path:
 * its libSQL adapter leaves transactions off unless `transaction: true`.
 */
function countingClient(db: Database) {
	let began = 0;
	let committed = 0;
	const run = (sql: string, args: readonly unknown[] = []) => {
		const statement = db.query(sql);
		if (/^\s*(select|pragma|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) {
			return { rows: statement.all(...(args as never[])), rowsAffected: 0, lastInsertRowid: 0 };
		}
		const result = statement.run(...(args as never[]));
		return {
			rows: [] as Record<string, unknown>[],
			rowsAffected: result.changes,
			lastInsertRowid: Number(result.lastInsertRowid ?? 0),
		};
	};
	const client = {
		execute(query: { sql: string; args?: readonly unknown[] }) {
			return run(query.sql, query.args ?? []);
		},
		async transaction() {
			db.run('BEGIN');
			began += 1;
			let closed = false;
			return {
				execute(query: { sql: string; args?: readonly unknown[] }) {
					return run(query.sql, query.args ?? []);
				},
				async commit() {
					if (closed) return;
					db.run('COMMIT');
					committed += 1;
					closed = true;
				},
				async rollback() {
					if (closed) return;
					db.run('ROLLBACK');
					closed = true;
				},
				async close() {},
			};
		},
		async close() {},
		counts: () => ({ began, committed }),
	};
	return client;
}

const signUp = (auth: { handler: (request: Request) => Promise<Response> }) =>
	auth.handler(
		new Request('https://procrastimate.test/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://procrastimate.test' },
			body: JSON.stringify({ email: 'tx@procrastimate.test', password: 'test-password-1', name: 'Tx' }),
		}),
	);

test('sign-up runs inside a libsql transaction', async () => {
	const db = new Database(':memory:');
	const client = countingClient(db);
	const auth = await authOnClient('transaction-test-secret-0123456789', client as unknown as Client);
	const response = await signUp(auth);
	expect(response.status).toBe(200);
	const { began, committed } = client.counts();
	expect(began).toBeGreaterThan(0);
	expect(committed).toBe(began);
	expect(db.query('select email from user').all()).toEqual([{ email: 'tx@procrastimate.test' }]);
});

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

test.skipIf(!tursoUrl || !tursoToken)('sign-up commits on the configured Turso database', async () => {
	const client = createClient({ url: tursoUrl!, authToken: tursoToken! });
	const email = `tx-${crypto.randomUUID()}@procrastimate.test`;
	const auth = await authOnClient('transaction-test-secret-0123456789', client);
	const response = await auth.handler(
		new Request('https://procrastimate.test/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://procrastimate.test' },
			body: JSON.stringify({ email, password: 'test-password-1', name: 'Tx' }),
		}),
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as { user?: { id?: string } };
	expect(body.user?.id).toBeTruthy();
	await client.execute({ sql: 'delete from session where userId = ?', args: [body.user!.id!] });
	await client.execute({ sql: 'delete from account where userId = ?', args: [body.user!.id!] });
	await client.execute({ sql: 'delete from user where id = ?', args: [body.user!.id!] });
	client.close();
});
