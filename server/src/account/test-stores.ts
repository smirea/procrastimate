import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { memoryStore } from './memory-store';
import { sqliteStore } from './sqlite-store';
import type { AccountStore } from './store';

/** A fresh SQLite store on an in-memory `bun:sqlite` database, standing in for Durable Object SQL. */
export function bunSqliteStore(userId = 'user-1'): AccountStore {
	return sqliteStore(drizzle(new Database(':memory:', { strict: true })), userId);
}

/** Both store implementations, so tests run each case against each. */
export const storeFactories: [string, () => AccountStore][] = [
	['memory', memoryStore],
	['sqlite', bunSqliteStore],
];
