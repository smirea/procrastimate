/**
 * One-time: production Postgres to a dump that `restoreDump` (server/src/db/backup.ts) loads into an empty database.
 * Run from the repository root with a read-only look at Postgres:
 *   POSTGRES_MODULE=<path to postgres.js> bun scripts/sync-engine-migration/import-postgres.ts <env file> <out.json>
 * The env file holds `DATABASE_URL='postgres://…'`. Nothing is written to Postgres; the read is one read-only
 * transaction, so every table comes from the same moment.
 */
import { getTableColumns, getTableName, type Column } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { SERVER_TABLES } from '../../server/src/db/migrate';

const [envFile, out] = process.argv.slice(2);
if (!envFile || !out) throw new Error('Usage: import-postgres.ts <env file> <out.json>');
const url = (await Bun.file(envFile).text()).match(/^DATABASE_URL='([^']*)'/m)?.[1];
if (!url) throw new Error(`${envFile} has no DATABASE_URL`);
const { default: postgres } = (await import(process.env.POSTGRES_MODULE ?? 'postgres')) as {
	default: (url: string, options: object) => any;
};

const camel = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** A Postgres value as the SQLite column's Drizzle property takes it. postgres.js reads `bigint` as text. */
function convert(column: Column, value: unknown): unknown {
	if (value === null || value === undefined) return null;
	switch (column.columnType) {
		case 'SQLiteInteger':
		case 'SQLiteReal':
			return Number(value);
		case 'SQLiteTimestamp':
			return value instanceof Date ? value : new Date(String(value));
		case 'SQLiteBoolean':
			return Boolean(value);
		case 'SQLiteCustomColumn':
			return { $bytes: Buffer.from(value as Uint8Array).toString('base64') };
		default:
			return value;
	}
}

/**
 * Every user's rows now share one database, whose row ids must be unique: a settings row is keyed by its user, and
 * a read by reader and task. The log follows its rows' ids, so the purge still finds which rows are gone.
 */
function rekey(table: string, row: Record<string, unknown>): Record<string, unknown> {
	if (table === 'settings') return { ...row, id: row.userId };
	if (table === 'reads') return { ...row, id: `${row.userId}:${row.id}` };
	if (table === 'log' && row.kind === 'settings') return { ...row, id: row.userId };
	if (table === 'log' && row.kind === 'read') return { ...row, id: `${row.userId}:${row.id}` };
	return row;
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const tables: Record<string, Record<string, unknown>[]> = {};
const at = new Date();
await sql.begin('isolation level repeatable read read only', async (tx: any) => {
	for (const table of SERVER_TABLES) {
		const name = getTableName(table);
		const columns = getTableColumns(table) as Record<string, Column>;
		const rows = (await tx.unsafe(`select * from "${name}"`)) as Record<string, unknown>[];
		tables[name] = rows.map(row => {
			const converted: Record<string, unknown> = {};
			for (const [pgName, value] of Object.entries(row)) {
				const key = camel(pgName);
				const column = columns[key];
				if (!column) throw new Error(`${name}.${pgName}: no column ${key} in the SQLite schema`);
				converted[key] = convert(column, value);
			}
			return rekey(name, converted);
		});
	}
});
await sql.end();

writeFileSync(out, JSON.stringify({ at: at.toISOString(), tables }));
console.log(`Dumped at ${at.toISOString()} to ${out}:`);
for (const [name, rows] of Object.entries(tables)) console.log(`  ${name.padEnd(14)} ${rows.length}`);
