import type { R2Bucket } from '@cloudflare/workers-types';
import { getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../../shared/db/schema';
import { authSchema } from './auth-schema';
import type { Db } from './postgres';

export const BACKUP_PREFIX = 'postgres/';
export const BACKUPS_KEPT = 30;

/** Every table, the app's and Better Auth's, read through Drizzle. */
const TABLES: PgTable[] = [
	...Object.values(schema as Record<string, unknown>).filter((value): value is PgTable => value instanceof PgTable),
	...Object.values(authSchema),
];

/** Bytes become base64 so the dump stays JSON; everything else is what the driver returns. */
const encode = (_key: string, value: unknown) =>
	value instanceof Uint8Array ? { $bytes: btoa(String.fromCharCode(...value)) } : value;

/** The whole database as one JSON document, one read transaction, so the dump is one consistent snapshot. */
export async function dumpJson(db: Db, at: Date): Promise<string> {
	return db.transaction(async tx => {
		const tables: Record<string, unknown[]> = {};
		for (const table of TABLES) tables[getTableName(table)] = await tx.select().from(table);
		return JSON.stringify({ at: at.toISOString(), tables }, encode);
	});
}

/** `postgres/2026-10-17.json`, so a lexicographic listing is oldest first and a rerun the same day overwrites. */
export const backupKey = (at: Date) => `${BACKUP_PREFIX}${at.toISOString().slice(0, 10)}.json`;

/**
 * Writes today's dump, then deletes all but the newest `BACKUPS_KEPT`. Pruning by count rather than age means a run
 * of failed days never deletes the last good backups.
 */
export async function backupDatabase(db: Db, bucket: R2Bucket, at: Date): Promise<string> {
	const key = backupKey(at);
	await bucket.put(key, await dumpJson(db, at), { httpMetadata: { contentType: 'application/json' } });
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
