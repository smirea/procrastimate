import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * Drizzle over any Postgres driver: postgres.js in the Bun dev server and over Hyperdrive on the Worker, PGlite in
 * unit tests. Feature code takes a `Db` and never sees the driver.
 */
export type Db = PgDatabase<PgQueryResultHKT>;

export type Connection = { db: Db; end: () => Promise<void> };

/**
 * A postgres.js client. The Bun dev server keeps one for its life; the Worker opens one per request over Hyperdrive,
 * which pools the real connections, and ends it after the response. `fetch_types` is off because Hyperdrive answers
 * the type lookup slowly and every column type here is one postgres.js already knows.
 */
export function connect(connectionString: string): Connection {
	const client = postgres(connectionString, { max: 5, fetch_types: false, onnotice: () => {} });
	return { db: drizzle(client), end: () => client.end() };
}
