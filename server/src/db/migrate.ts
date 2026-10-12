import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrations } from './generated/migrations';
import { batch } from './turso';

/**
 * Applies `server/drizzle`, bundled into `generated/migrations.ts` because neither the Worker nor a Durable Object
 * can read migration files. The bookkeeping table is drizzle-kit's own, so `drizzle-kit migrate` agrees with it.
 */

export type SyncDatabase = BaseSQLiteDatabase<'sync', unknown>;

const TABLE = sql.identifier('__drizzle_migrations');
const CREATE = sql`CREATE TABLE IF NOT EXISTS ${TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`;
const LAST = sql`SELECT created_at AS at FROM ${TABLE} ORDER BY created_at DESC LIMIT 1`;
const record = (when: number) => sql`INSERT INTO ${TABLE} ("hash", "created_at") VALUES ('', ${when})`;

/**
 * Tables from before accounts were per user have no `user_id`, and the baseline's `IF NOT EXISTS` would keep them.
 * They are dropped. There is no backwards-compatible read: one user's flush used to delete every row.
 */
const UNSCOPED = sql`SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'entities'
	AND NOT EXISTS (SELECT 1 FROM pragma_table_info('entities') WHERE name = 'user_id')`;
const DROP_UNSCOPED = ['entities', 'log', 'devices', 'meta', 'push', 'ramble_usage'].map(
	table => sql`DROP TABLE IF EXISTS ${sql.identifier(table)}`,
);

/** `all`, not `get`: drizzle's libSQL `get` throws on a raw query that finds no row. */
const pending = ([last]: { at: unknown }[]) => migrations.filter(m => !last || Number(last.at) < m.when);

export function migrateSync(db: SyncDatabase) {
	if (db.all(UNSCOPED).length) for (const drop of DROP_UNSCOPED) db.run(drop);
	db.run(CREATE);
	const todo = pending(db.all<{ at: unknown }>(LAST));
	if (!todo.length) return;
	db.transaction(tx => {
		for (const migration of todo) {
			for (const statement of migration.statements) tx.run(sql.raw(statement));
			tx.run(record(migration.when));
		}
	});
}

export async function migrateAsync(db: LibSQLDatabase) {
	if ((await db.all(UNSCOPED)).length)
		await batch(
			db,
			DROP_UNSCOPED.map(drop => db.run(drop)),
		);
	await db.run(CREATE);
	const todo = pending(await db.all<{ at: unknown }>(LAST));
	const statements = todo.flatMap(m => [...m.statements.map(s => db.run(sql.raw(s))), db.run(record(m.when))]);
	await batch(db, statements);
}
