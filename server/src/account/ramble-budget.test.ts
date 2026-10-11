import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { Client, InStatement, ResultSet } from '@libsql/client/web';
import { memoryRambleBudget, tursoRambleBudget } from './ramble-budget';

function sqliteClient(): Client {
	const db = new Database(':memory:', { strict: true });
	const run = (statement: InStatement) => {
		const sql = typeof statement === 'string' ? statement : statement.sql;
		const args = typeof statement === 'string' ? [] : (statement.args ?? []);
		const query = db.query(sql);
		const rows = sql.trimStart().toUpperCase().startsWith('SELECT')
			? query.all(...(args as SQLQueryBindings[]))
			: (query.run(...(args as SQLQueryBindings[])), []);
		return { rows } as unknown as ResultSet;
	};
	const client: Pick<Client, 'execute' | 'batch'> = {
		execute: statement => Promise.resolve(run(statement)),
		batch: async statements => statements.map(statement => run(statement as InStatement)),
	};
	return client as Client;
}

test('concurrent reserves stay inside the daily budget and release gives time back', async () => {
	const budget = memoryRambleBudget(10);
	const grants = await Promise.all([1, 2, 3, 4].map(() => budget.reserve('2026-10-14', 4)));
	expect(grants.reduce((sum, granted) => sum + granted, 0)).toBe(10);
	await budget.release('2026-10-14', 3);
	expect(await budget.reserve('2026-10-14', 4)).toBe(3);
	expect(await budget.reserve('2026-10-15', 4)).toBe(4);
});

test('the Turso budget grants only what the UTC day has left', async () => {
	const budget = tursoRambleBudget(sqliteClient(), 10);
	expect(await budget.reserve('2026-10-14', 4)).toBe(4);
	expect(await budget.reserve('2026-10-14', 8)).toBe(6);
	await budget.release('2026-10-14', 3);
	expect(await budget.reserve('2026-10-14', 4)).toBe(3);
	expect(await budget.reserve('2026-10-14', 0)).toBe(0);
});
