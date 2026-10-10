import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { memoryStore } from './memory-store';
import { sqliteStore, type Sql } from './sqlite-store';
import type { AccountStore } from './store';

/** A fresh SQLite store on an in-memory `bun:sqlite` database, standing in for Durable Object SQL. */
export function bunSqliteStore(): AccountStore {
	const db = new Database(':memory:', { strict: true });
	const sql: Sql = {
		exec: <T>(query: string, ...bindings: (ArrayBuffer | string | number | null)[]) => ({
			toArray: () => db.query(query).all(...(bindings as SQLQueryBindings[])) as T[],
		}),
	} as Sql;
	return sqliteStore(sql, run => db.transaction(run)());
}

/** Both store implementations, so tests run each case against each. */
export const storeFactories: [string, () => AccountStore][] = [
	['memory', memoryStore],
	['sqlite', bunSqliteStore],
];
