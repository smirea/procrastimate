import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { Logger } from 'drizzle-orm';
import { bunSqlite } from 'sync-engine/bun-sqlite';
import { createSpace, type Space, type SqlDriver } from 'sync-engine/core';
import { syncSchema } from '../../../shared/db/sync';
import { syncHooks, type SyncContext } from '../writes';
import { migrateServer } from './migrate';
import type { Db } from './sqlite';

/**
 * The server's one database, three ways in: Drizzle for the app's queries, the engine's driver, and the engine's space
 * over the synced tables with the app's hooks. All three share one SQLite connection, so the engine's transaction
 * covers what the hooks write through Drizzle.
 */
export type Store = { db: Db; driver: SqlDriver; space: Space<SyncContext> };

export function openStore(db: Db, driver: SqlDriver): Store {
	const space = createSpace(driver, syncSchema, { hooks: syncHooks(db) });
	space.migrate();
	migrateServer(driver);
	return { db, driver, space };
}

/** A Durable Object binds at most 100 parameters per statement, so local runs refuse more, as production would. */
export const MAX_PARAMETERS = 100;

const tooMany = (sql: string, count: number) =>
	new Error(`A statement bound ${count} parameters, over the Durable Object's ${MAX_PARAMETERS}: ${sql.slice(0, 200)}`);

const parameterGuard: Logger = {
	logQuery(query, params) {
		if (params.length > MAX_PARAMETERS) throw tooMany(query, params.length);
	},
};

/** The store over `bun:sqlite`, for the Bun dev server (a file) and tests (`:memory:`). */
export function bunStore(path: string, logger?: Logger): Store {
	const sqlite = new Database(path, { create: true });
	if (path !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL');
	sqlite.exec('PRAGMA foreign_keys = ON');
	const engine = bunSqlite(sqlite);
	const driver: SqlDriver = {
		exec(sql, params = []) {
			if (params.length > MAX_PARAMETERS) throw tooMany(sql, params.length);
			return engine.exec(sql, params);
		},
		transaction: fn => engine.transaction(fn),
	};
	const db = drizzle(sqlite, {
		logger: {
			logQuery(query, params) {
				parameterGuard.logQuery(query, params);
				logger?.logQuery(query, params);
			},
		},
	});
	return openStore(db as unknown as Db, driver);
}
