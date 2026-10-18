import { sql } from 'drizzle-orm';
import { migrations } from './generated/migrations';
import type { Db } from './postgres';

/**
 * Applies `server/drizzle`, bundled into `generated/migrations.ts` because the Worker cannot read the migration
 * files. The bookkeeping table is drizzle-kit's own, so `drizzle-kit migrate` agrees with it. Every run takes a
 * transaction-level advisory lock first, so Worker isolates and dev servers starting together apply each migration
 * once. A database whose history is not a prefix of these migrations fails before a statement runs: a worktree
 * database recovers with `bun scripts/setup-worktree.ts --reset-db`; production never should.
 */

export class MigrationHistoryError extends Error {
	constructor(
		readonly expected: number[],
		readonly found: number[],
		readonly tables: string[],
	) {
		const history = found.length ? `[${found.join(', ')}]` : `none, with tables ${tables.join(', ')}`;
		super(
			`The database's migration history is not a prefix of server/drizzle, so nothing was migrated. ` +
				`Expected a prefix of [${expected.join(', ')}], found ${history}. ` +
				`A worktree database recovers with \`bun scripts/setup-worktree.ts --reset-db\`.`,
		);
		this.name = 'MigrationHistoryError';
	}
}

const TABLE = sql`${sql.identifier('drizzle')}.${sql.identifier('__drizzle_migrations')}`;
/** Any constant; it only has to be the same in every process that migrates this database. */
const LOCK_KEY = 7_419_201;

type Applied = { created_at: string | number };
type Table = { tablename: string };

/** The migrations still to apply, or a `MigrationHistoryError` when the applied ones are not ours. */
export function pending(applied: number[], tables: string[]): typeof migrations {
	const history = migrations.map(migration => migration.when);
	const ours = applied.length
		? applied.length <= history.length && applied.every((at, index) => at === history[index])
		: tables.length === 0;
	if (!ours) throw new MigrationHistoryError(history, applied, tables);
	return migrations.slice(applied.length);
}

export async function migrate(db: Db): Promise<string[]> {
	return db.transaction(async tx => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
		await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier('drizzle')}`);
		await tx.execute(
			sql`CREATE TABLE IF NOT EXISTS ${TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
		);
		const applied = rows<Applied>(await tx.execute(sql`SELECT created_at FROM ${TABLE} ORDER BY created_at`)).map(row =>
			Number(row.created_at),
		);
		const tables = rows<Table>(
			await tx.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`),
		).map(row => row.tablename);
		const todo = pending(applied, tables);
		for (const migration of todo) {
			for (const statement of migration.statements) await tx.execute(sql.raw(statement));
			await tx.execute(sql`INSERT INTO ${TABLE} (hash, created_at) VALUES ('', ${migration.when})`);
		}
		return todo.map(migration => migration.tag);
	});
}

/** postgres.js answers `execute` with the row array itself; PGlite wraps it in `{ rows }`. */
function rows<T>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	return (result as { rows: T[] }).rows;
}
