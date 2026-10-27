import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/**
 * The server's Drizzle database: `bun:sqlite` in the Bun dev server and tests, the Durable Object's SQLite storage on
 * the Worker. Both are synchronous, so a query runs to completion before anything else does, which is what lets the
 * engine's hooks read and write inside its transaction.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown>;
