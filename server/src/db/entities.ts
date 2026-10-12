import { getTableColumns } from 'drizzle-orm';
import { ENTITY_TABLES } from '../../../shared/db/schema';
import { KINDS, type Kind } from '../../../shared/sync/kinds';
import type { ServerEntity } from '../../../shared/sync/merge';
import type { Fields } from '../../../shared/sync/snapshot';

/**
 * The sync core works on entities: a kind, an id, the fields it holds, and one clock per field. Each kind has its
 * own table, so an entity is a row whose clocks say which columns it holds.
 */

export type EntityTable = (typeof ENTITY_TABLES)[Kind];

const KEYS = new Set(['userId', 'id', 'clocks']);
const COLUMNS = Object.fromEntries(
	KINDS.map(kind => [kind, Object.entries(getTableColumns(ENTITY_TABLES[kind])).filter(([key]) => !KEYS.has(key))]),
) as Record<Kind, [string, Column][]>;

type Column = { default: unknown; columnType: string; notNull: boolean };

/** What a `NOT NULL` column without a default holds until its field arrives. No clock vouches for it. */
const FILLER: Record<string, unknown> = { SQLiteText: '', SQLiteInteger: 0, SQLiteReal: 0, SQLiteBoolean: false };
const filler = (column: Column) => column.default ?? (column.notNull ? FILLER[column.columnType] : null) ?? null;

/**
 * An entity's row. A column whose field the entity does not hold yet, as after a partial edit the server heard
 * before the create, keeps its default or a filler, which no clock vouches for.
 */
export function entityRow(userId: string, { kind, id, data, clocks }: ServerEntity) {
	const row: Record<string, unknown> = { userId, id, clocks };
	for (const [key, column] of COLUMNS[kind]) row[key] = key in data ? data[key] : filler(column);
	// Built column by column from the table itself, which is what the insert type describes.
	return row as EntityTable['$inferInsert'];
}

/** The entity a row holds: only the columns its clocks name. */
export function rowEntity(kind: Kind, row: { id: string; clocks: ServerEntity['clocks'] } & Fields): ServerEntity {
	const data: Fields = {};
	for (const [key] of COLUMNS[kind]) if (key in row.clocks) data[key] = row[key];
	return { kind, id: row.id, data, clocks: row.clocks };
}

export { ENTITY_TABLES };
