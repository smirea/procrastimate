import { sql, type SQL } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { migrations } from './generated/migrations';
import { batch } from './turso';

/**
 * Applies `server/drizzle`, bundled into `generated/migrations.ts` because neither the Worker nor a Durable Object
 * can read migration files. The bookkeeping table is drizzle-kit's own, so `drizzle-kit migrate` agrees with it.
 *
 * A database whose history is not a prefix of these migrations either fails (`strict`, every database that holds
 * real data) or is wiped and rebuilt (`rebuild`, only for in-memory and test databases). The caller decides, because
 * a wrong guess from the environment would wipe production.
 */

export type MigrateMode = 'strict' | 'rebuild';
export type SyncDatabase = BaseSQLiteDatabase<'sync', unknown>;

export class MigrationHistoryError extends Error {
	constructor(
		readonly expected: number[],
		readonly found: number[],
		readonly tables: string[],
	) {
		const history = found.length ? `[${found.join(', ')}]` : `none, with tables ${tables.join(', ')}`;
		super(
			`The database's migration history is not a prefix of server/drizzle, so nothing was migrated or dropped. ` +
				`Expected a prefix of [${expected.join(', ')}], found ${history}.`,
		);
		this.name = 'MigrationHistoryError';
	}
}

const BOOKKEEPING = '__drizzle_migrations';
const TABLE = sql.identifier(BOOKKEEPING);
const CREATE = sql`CREATE TABLE IF NOT EXISTS ${TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`;
/** SQLite's, Cloudflare's, and libSQL's own tables stay. */
const TABLES = sql`SELECT name FROM sqlite_master WHERE type = 'table'
	AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name NOT GLOB 'libsql_*'`;
const APPLIED = sql`SELECT DISTINCT created_at AS at FROM ${TABLE} ORDER BY created_at`;
const PARENTS = (table: string) => sql`SELECT DISTINCT "table" AS name FROM pragma_foreign_key_list(${table})`;
const record = (when: number) => sql`INSERT INTO ${TABLE} ("hash", "created_at") VALUES ('', ${when})`;

type Name = { name: string };
type Applied = { at: unknown };

/** Every table, each after the tables that reference it, so dropping in order never breaks a foreign key. */
function dropOrder(tables: string[], parentsOf: (table: string) => string[]): string[] {
	const order: string[] = [];
	const remaining = new Set(tables);
	while (remaining.size) {
		const referenced = new Set([...remaining].flatMap(table => parentsOf(table).filter(parent => parent !== table)));
		const free = [...remaining].filter(table => !referenced.has(table));
		const next = free.length ? free : [...remaining];
		for (const table of next) {
			order.push(table);
			remaining.delete(table);
		}
	}
	return order;
}

const apply = (todo: typeof migrations): SQL[] =>
	todo.flatMap(migration => [...migration.statements.map(statement => sql.raw(statement)), record(migration.when)]);

/** Throws in `strict` mode before a single statement runs, so a mismatch changes nothing. */
function plan(tables: string[], applied: number[], parentsOf: (table: string) => string[], mode: MigrateMode): SQL[] {
	const history = migrations.map(migration => migration.when);
	// An empty history is ours only on an empty database, so a rebuild that failed halfway runs again.
	const others = tables.filter(table => table !== BOOKKEEPING);
	const ours = applied.length
		? applied.length <= history.length && applied.every((at, index) => at === history[index])
		: others.length === 0;
	if (ours) {
		const todo = migrations.slice(applied.length);
		return todo.length ? [CREATE, ...apply(todo)] : [];
	}
	if (mode === 'strict') throw new MigrationHistoryError(history, applied, others);
	return [
		...dropOrder(tables, parentsOf).map(table => sql`DROP TABLE IF EXISTS ${sql.identifier(table)}`),
		CREATE,
		...apply(migrations),
	];
}

export function migrateSync(db: SyncDatabase, mode: MigrateMode) {
	const tables = db.all<Name>(TABLES).map(row => row.name);
	const applied = tables.includes(BOOKKEEPING) ? db.all<Applied>(APPLIED).map(row => Number(row.at)) : [];
	const steps = plan(tables, applied, table => db.all<Name>(PARENTS(table)).map(row => row.name), mode);
	if (steps.length) db.transaction(tx => steps.forEach(step => tx.run(step)));
}

export async function migrateAsync(db: LibSQLDatabase, mode: MigrateMode) {
	const tables = (await db.all<Name>(TABLES)).map(row => row.name);
	const applied = tables.includes(BOOKKEEPING) ? (await db.all<Applied>(APPLIED)).map(row => Number(row.at)) : [];
	const parents = new Map(
		await Promise.all(
			tables.map(async table => [table, (await db.all<Name>(PARENTS(table))).map(row => row.name)] as const),
		),
	);
	const steps = plan(tables, applied, table => parents.get(table) ?? [], mode);
	await batch(
		db,
		steps.map(step => db.run(step)),
	);
}
