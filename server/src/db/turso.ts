import { createClient, type Client } from '@libsql/client/web';
import type { BatchItem } from 'drizzle-orm/batch';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { drizzle } from 'drizzle-orm/libsql/web';
import type { Env } from '../bindings';
import { migrateAsync } from './migrate';

export type TursoTarget = { url: string; authToken: string };
export type TursoDatabase = LibSQLDatabase;

/** Both Turso secrets, unless an end-to-end shard runs, which must never write the dev database. */
export function tursoTarget(env: Env): TursoTarget | null {
	if (env.E2E_SHARD || !env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) return null;
	return { url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN };
}

const opened = new Map<string, Promise<TursoDatabase>>();

/** Migrates once per database and isolate, not on every request. A failed open is retried by the next caller. */
export function tursoDatabase({ url, authToken }: TursoTarget): Promise<TursoDatabase> {
	const existing = opened.get(url);
	if (existing) return existing;
	const pending = openDatabase(createClient({ url, authToken })).catch(error => {
		opened.delete(url);
		throw error;
	});
	opened.set(url, pending);
	return pending;
}

export async function openDatabase(client: Client): Promise<TursoDatabase> {
	const db = drizzle(client);
	await migrateAsync(db);
	return db;
}

/** One round trip, in one transaction. Drizzle's `batch` wants a non-empty tuple. */
export async function batch(db: TursoDatabase, queries: BatchItem<'sqlite'>[]): Promise<void> {
	const [first, ...rest] = queries;
	if (first) await db.batch([first, ...rest]);
}
