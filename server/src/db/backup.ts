import { createClient, type Client, type Transaction, type Value } from '@libsql/client/web';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { TursoTarget } from './turso';

export const BACKUP_PREFIX = 'turso/';
export const BACKUPS_KEPT = 30;

type SchemaRow = { type: 'table' | 'index' | 'trigger' | 'view'; name: string; sql: string };

/** Like `migrate.ts`, SQLite's, Cloudflare's, and libSQL's own objects are left out, except the AUTOINCREMENT counters. */
const SCHEMA = `select type, name, sql from sqlite_master where sql is not null
	and (name = 'sqlite_sequence' or name not glob 'sqlite_*') and name not glob '_cf_*' and name not glob 'libsql_*'
	order by rowid`;

const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`;

function literal(value: Value): string {
	if (value === null) return 'NULL';
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`Cannot dump the non-finite number ${value}`);
		return Number.isInteger(value) ? value.toFixed(1) : String(value);
	}
	if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
	const bytes = new Uint8Array(value);
	return `X'${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}'`;
}

/**
 * The whole database as SQL that `sqlite3` replays into an empty file, like its `.dump`. The schema and every table
 * are read in one read transaction, so the dump is one consistent snapshot even while a deploy migrates. Integers come back as bigints, so none lose precision.
 */
export async function dumpSql(client: Client): Promise<string> {
	const transaction = await client.transaction('read');
	try {
		return await dumpTransaction(transaction);
	} finally {
		transaction.close();
	}
}

async function dumpTransaction(transaction: Transaction): Promise<string> {
	const schema = (await transaction.execute(SCHEMA)).rows as unknown as SchemaRow[];
	// SQLite creates `sqlite_sequence` with the first AUTOINCREMENT table and bumps it on every insert, so its rows go
	// last, after a reset, as `sqlite3 .dump` does.
	const tables = schema.filter(row => row.type === 'table' && row.name !== 'sqlite_sequence');
	const sequenced = schema.some(row => row.name === 'sqlite_sequence');
	const reads = tables.map(table => `select * from ${quoteName(table.name)}`);
	if (sequenced) reads.push('select * from sqlite_sequence');
	const results = await transaction.batch(reads);

	const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
	const inserts = (name: string, index: number) => {
		for (const row of results[index]!.rows) {
			lines.push(`INSERT INTO ${quoteName(name)} VALUES(${Array.from(row, literal).join(',')});`);
		}
	};
	tables.forEach((table, index) => {
		lines.push(`${table.sql};`);
		inserts(table.name, index);
	});
	if (sequenced) {
		lines.push('DELETE FROM sqlite_sequence;');
		inserts('sqlite_sequence', tables.length);
	}
	for (const row of schema) if (row.type !== 'table') lines.push(`${row.sql};`);
	lines.push('COMMIT;', '');
	return lines.join('\n');
}

/** `turso/2026-10-17.sql`, so a lexicographic listing is oldest first and a rerun the same day overwrites. */
export const backupKey = (at: Date) => `${BACKUP_PREFIX}${at.toISOString().slice(0, 10)}.sql`;

/**
 * Writes today's dump, then deletes all but the newest `BACKUPS_KEPT`. Pruning by count rather than age means a run
 * of failed days never deletes the last good backups.
 */
export async function backupTurso(target: TursoTarget, bucket: R2Bucket, at: Date): Promise<string> {
	const client = createClient({ ...target, intMode: 'bigint' });
	try {
		const key = backupKey(at);
		// Uncompressed: gzip cost a third of the free plan's 10 ms CPU budget, and 30 dumps are far below R2's free 10 GB.
		await bucket.put(key, await dumpSql(client), { httpMetadata: { contentType: 'application/sql' } });
		await pruneBackups(bucket);
		return key;
	} finally {
		client.close();
	}
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
