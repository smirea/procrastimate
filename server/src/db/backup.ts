import type { R2Bucket } from '@cloudflare/workers-types';
import { getTableColumns, getTableName, sql, type Column } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { base64Decode, base64Encode } from '../jwt';
import { user } from './auth-schema';
import { SERVER_TABLES } from './migrate';
import type { Db } from './sqlite';

export const BACKUP_PREFIX = 'sqlite/';
export const BACKUPS_KEPT = 30;
/** Where the `App` object looks for a dump to load into an empty database on start. */
export const RESTORE_KEY = 'restore/pending.json';

/** Every table but the engine's bookkeeping, which a restore starts fresh. */
export type Dump = { at: string; tables: Record<string, Record<string, unknown>[]> };

/** Bytes become base64 so the dump stays JSON; everything else is what Drizzle reads. */
const encode = (_key: string, value: unknown) =>
	value instanceof Uint8Array ? { $bytes: base64Encode(value) } : value;

/** The whole database as one JSON document, read in one transaction, so every table comes from the same moment. */
export function dumpJson(db: Db, at: Date): string {
	return db.transaction(tx => {
		const tables: Dump['tables'] = {};
		for (const table of SERVER_TABLES) tables[getTableName(table)] = tx.select().from(table).all();
		return JSON.stringify({ at: at.toISOString(), tables } satisfies Dump, encode);
	});
}

/** A dumped value as its column takes it again: dates from their JSON text, bytes from base64. */
function decode(column: Column, value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (column.columnType === 'SQLiteTimestamp') return new Date(value as string);
	if (typeof value === 'object' && value !== null && '$bytes' in value) return base64Decode(String(value.$bytes));
	return value;
}

/**
 * Loads a dump into an empty database, one row per statement for the Durable Object's 100 parameters, in one
 * transaction. The rows go in under the engine, so it logs nothing, and the head and horizon move past any cursor a
 * device could hold, so every device takes a fresh snapshot instead of trusting a delta from the database it had.
 * Refuses a database that holds a user, so it never merges into live data.
 */
export function restoreDump(db: Db, dump: Dump, now: number): Record<string, number> {
	const counts: Record<string, number> = {};
	db.transaction(tx => {
		if (tx.select({ id: user.id }).from(user).limit(1).get()) {
			throw new Error('restore: the database already holds users; restore only into an empty one');
		}
		for (const table of SERVER_TABLES as SQLiteTable[]) {
			const name = getTableName(table);
			const rows = dump.tables[name] ?? [];
			const columns = getTableColumns(table) as Record<string, Column>;
			for (const row of rows) {
				const values = Object.fromEntries(
					Object.entries(row)
						.filter(([key]) => key in columns)
						.map(([key, value]) => [key, decode(columns[key]!, value)]),
				);
				tx.insert(table).values(values).run();
			}
			counts[name] = rows.length;
		}
		tx.run(sql`UPDATE _meta SET value = ${now} WHERE key IN ('head', 'horizon')`);
	});
	return counts;
}

/** `sqlite/2026-10-17.json`, so a lexicographic listing is oldest first and a rerun the same day overwrites. */
export const backupKey = (at: Date) => `${BACKUP_PREFIX}${at.toISOString().slice(0, 10)}.json`;

/**
 * Writes today's dump, then deletes all but the newest `BACKUPS_KEPT`. Pruning by count rather than age means a run
 * of failed days never deletes the last good backups.
 */
export async function backupDatabase(db: Db, bucket: R2Bucket, at: Date): Promise<string> {
	const key = backupKey(at);
	await bucket.put(key, dumpJson(db, at), { httpMetadata: { contentType: 'application/json' } });
	await pruneBackups(bucket);
	return key;
}

export async function pruneBackups(bucket: R2Bucket): Promise<void> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
		keys.push(...page.objects.map(object => object.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	const stale = keys.sort().slice(0, -BACKUPS_KEPT);
	if (stale.length) await bucket.delete(stale);
}
