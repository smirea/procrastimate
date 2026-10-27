import { Database } from 'bun:sqlite';
import type { Logger } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { bunSqlite } from 'sync-engine/bun-sqlite';
import type { SqlDriver } from 'sync-engine/core';
import type { Db } from './sqlite';
import { openStore, type Store } from './store';

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
