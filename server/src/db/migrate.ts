import { is, SQL } from 'drizzle-orm';
import { getTableConfig, SQLiteSyncDialect, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { SqlDriver } from 'sync-engine/core';
import * as schema from '../../../shared/db/schema';
import { authSchema } from './auth-schema';

/**
 * The server's tables beside the engine's: the server-only ones, Better Auth's, and the indexes the synced tables
 * need on the server. Migrations are additive and computed from the live database, like the engine's: a missing table
 * is created, a missing column added, a missing index created. Nothing is ever dropped or retyped, and there is no
 * history to agree with, so every start of the Bun server or the Durable Object runs it.
 */

const dialect = new SQLiteSyncDialect();
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const render = (value: SQL) => {
	const query = dialect.sqlToQuery(value);
	if (query.params.length) throw new Error(`migrate: index SQL must not take parameters: ${query.sql}`);
	return query.sql;
};

export const SERVER_TABLES: SQLiteTable[] = [
	...Object.values(schema as Record<string, unknown>).filter(
		(value): value is SQLiteTable => value instanceof SQLiteTable,
	),
	...Object.values(authSchema),
];

type Config = ReturnType<typeof getTableConfig>;
type ConfigColumn = Config['columns'][number];

function literal(column: ConfigColumn): string | null {
	const raw = column.default;
	if (raw === undefined) return null;
	if (is(raw, SQL)) return `(${render(raw)})`;
	const value = column.mapToDriverValue(raw);
	if (value === null) return 'NULL';
	if (typeof value === 'number' || typeof value === 'bigint') return String(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	return `'${String(value).replaceAll("'", "''")}'`;
}

function columnDdl(column: ConfigColumn, inlinePrimary: boolean): string {
	let ddl = `${quote(column.name)} ${column.getSQLType()}`;
	if (inlinePrimary && column.primary) {
		ddl += ' PRIMARY KEY';
		if ((column as { autoIncrement?: boolean }).autoIncrement) ddl += ' AUTOINCREMENT';
	}
	if (column.notNull && !(inlinePrimary && column.primary)) ddl += ' NOT NULL';
	if (column.isUnique) ddl += ' UNIQUE';
	const fallback = literal(column);
	if (fallback !== null) ddl += ` DEFAULT ${fallback}`;
	return ddl;
}

function createTable(config: Config): string {
	const composite = config.primaryKeys[0];
	const parts = config.columns.map(column => columnDdl(column, !composite));
	if (composite) parts.push(`PRIMARY KEY (${composite.columns.map(column => quote(column.name)).join(', ')})`);
	for (const key of config.foreignKeys) {
		const reference = key.reference();
		const onDelete = key.onDelete ? ` ON DELETE ${key.onDelete.toUpperCase()}` : '';
		parts.push(
			`FOREIGN KEY (${reference.columns.map(c => quote(c.name)).join(', ')}) REFERENCES ${quote(
				getTableConfig(reference.foreignTable).name,
			)} (${reference.foreignColumns.map(c => quote(c.name)).join(', ')})${onDelete}`,
		);
	}
	return `CREATE TABLE IF NOT EXISTS ${quote(config.name)} (${parts.join(', ')})`;
}

function createIndex(table: string, index: Config['indexes'][number]): string {
	const { name, columns, unique, where } = index.config;
	const on = columns.map(column => (is(column, SQL) ? render(column) : quote(column.name))).join(', ');
	return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(name)} ON ${quote(table)} (${on})${
		where ? ` WHERE ${render(where)}` : ''
	}`;
}

/** Every statement a database without the server's tables runs, in order. Exported for the schema test. */
export function serverStatements(tables: readonly SQLiteTable[] = SERVER_TABLES): string[] {
	const configs = tables.map(table => getTableConfig(table));
	return [
		...configs.map(createTable),
		...configs.flatMap(config => config.indexes.map(index => createIndex(config.name, index))),
	];
}

/** Creates what is missing. A NOT NULL column without a default cannot be added to a table that has rows. */
export function migrateServer(driver: SqlDriver, tables: readonly SQLiteTable[] = SERVER_TABLES): void {
	driver.transaction(() => {
		const configs = tables.map(table => getTableConfig(table));
		for (const config of configs) {
			driver.exec(createTable(config));
			const present = new Set(driver.exec(`PRAGMA table_info(${quote(config.name)})`).map(row => row.name));
			for (const column of config.columns) {
				if (present.has(column.name)) continue;
				if (column.notNull && column.default === undefined) {
					throw new Error(`${config.name}.${column.name}: a NOT NULL column without a default cannot be added`);
				}
				driver.exec(`ALTER TABLE ${quote(config.name)} ADD COLUMN ${columnDdl(column, false)}`);
			}
		}
		for (const config of configs) for (const index of config.indexes) driver.exec(createIndex(config.name, index));
	});
}
