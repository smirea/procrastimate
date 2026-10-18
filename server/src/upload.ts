import { getTableColumns, is, SQL } from 'drizzle-orm';
import type { Actor } from '../../shared/auth';
import { ENTITY_TABLES } from '../../shared/db/schema';
import { FIELDS_SCHEMAS, KINDS, SETTINGS_ID, type Kind } from '../../shared/model';
import { KIND_OF, TABLE_OF, type SyncedTable } from '../../shared/rows';
import type { Fields } from '../../shared/snapshot';
import type { Client } from '../../shared/values';
import type { Db } from './db/postgres';
import { reportError } from './sentry';
import { applyWrites, type OwnedWrite, type Rejected } from './writes';

/**
 * `POST /api/upload`: a client's queued PowerSync writes. This file is the boundary between PowerSync's wire shape
 * (snake_case columns, JSON as text, numbers sometimes as text) and the domain's `RowWrite` with parsed camelCase
 * fields, which `applyWrites` takes from here. One bad write is rejected alone and the rest still apply, and the
 * route never answers a 4xx for the batch, because PowerSync stops uploading on one.
 */

type ColumnKind = 'text' | 'number' | 'json';
type Column = { key: string; kind: ColumnKind };

const COLUMN_KINDS: Record<string, ColumnKind> = {
	PgText: 'text',
	PgInteger: 'number',
	PgBigInt53: 'number',
	PgDoublePrecision: 'number',
	PgJsonb: 'json',
};

/**
 * What a put means for a column it leaves out: PowerSync omits null columns from a PUT's data, so a missing one is the
 * table's default where there is one and null otherwise. A `NOT NULL` column without a default stays missing, and the
 * row schema refuses the put.
 */
const PUT_DEFAULTS: Record<Kind, Fields> = Object.fromEntries(
	KINDS.map(kind => [
		kind,
		Object.fromEntries(
			Object.entries(
				getTableColumns(ENTITY_TABLES[kind]) as Record<string, { default?: unknown; notNull: boolean }>,
			).flatMap(([key, column]) => {
				if (key === 'id' || key === 'userId') return [];
				if (column.default !== undefined && !is(column.default, SQL)) return [[key, column.default]];
				return column.notNull ? [] : [[key, null]];
			}),
		),
	]),
) as Record<Kind, Fields>;

/** Each synced table's columns by wire name, from the schema, so a new column needs no change here. */
const COLUMNS: Record<Kind, Map<string, Column>> = Object.fromEntries(
	KINDS.map(kind => [
		kind,
		new Map(
			Object.entries(getTableColumns(ENTITY_TABLES[kind]) as Record<string, { name: string; columnType: string }>).map(
				([key, column]) => {
					const columnKind = COLUMN_KINDS[column.columnType];
					if (!columnKind) throw new Error(`${TABLE_OF[kind]}.${key}: no upload parser for ${column.columnType}`);
					return [column.name, { key, kind: columnKind }];
				},
			),
		),
	]),
) as Record<Kind, Map<string, Column>>;

function coerce(column: Column, value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (column.kind === 'json' && typeof value === 'string') {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}
	if (column.kind === 'number' && typeof value === 'string' && value.trim() !== '') return Number(value);
	return value;
}

/** Wire columns to domain fields, dropping the keys (`id`, `user_id`) and anything the table lacks. */
function fieldsOf(kind: Kind, values: Record<string, unknown>): { owner: string | null; fields: Fields } {
	const fields: Fields = {};
	let owner: string | null = null;
	for (const [name, raw] of Object.entries(values)) {
		const column = COLUMNS[kind].get(name);
		if (!column || column.key === 'id') continue;
		const value = coerce(column, raw);
		if (column.key === 'userId') owner = typeof value === 'string' ? value : null;
		else fields[column.key] = value;
	}
	return { owner, fields };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** One wire write parsed, or why it was refused. */
export function parseWrite(raw: unknown): { write: OwnedWrite } | { rejected: Rejected } {
	if (!isRecord(raw) || typeof raw.table !== 'string' || typeof raw.id !== 'string') {
		return { rejected: { table: String(isRecord(raw) ? raw.table : ''), id: '', reason: 'Malformed write' } };
	}
	const { table, id, op } = raw;
	const opId = typeof raw.opId === 'string' ? raw.opId : undefined;
	const reject = (reason: string) => ({ rejected: { table, id, reason } });
	const kind = KIND_OF[table as SyncedTable];
	if (!kind) return reject(`Unknown table ${table}`);
	if (op === 'delete') return { write: { op, kind, id, opId, owner: null } };
	if (op !== 'put' && op !== 'patch') return reject(`Unknown op ${String(op)}`);
	if (!isRecord(raw.values)) return reject('A put or patch needs values');
	const { owner, fields } = fieldsOf(kind, raw.values);
	if (op === 'put' && !owner) return reject('A put needs user_id');
	if (kind === 'settings' && id !== SETTINGS_ID) return reject(`Settings rows are named ${SETTINGS_ID}`);
	const schema = op === 'put' ? FIELDS_SCHEMAS[kind] : FIELDS_SCHEMAS[kind].partial();
	const parsed = schema.safeParse(op === 'put' ? { ...PUT_DEFAULTS[kind], ...fields } : fields);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		return reject(`${issue.path.join('.') || 'values'}: ${issue.message}`);
	}
	const values = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
	return { write: { op, kind, id, opId, owner, values } };
}

/** The whole route after authentication: parse every write alone, then apply what parsed. */
export async function upload(
	db: Db,
	actor: Actor,
	client: Client,
	raw: readonly unknown[],
	now = Date.now(),
): Promise<{ rejected: Rejected[] }> {
	const rejected: Rejected[] = [];
	const writes: OwnedWrite[] = [];
	for (const entry of raw) {
		const result = parseWrite(entry);
		if ('rejected' in result) rejected.push(result.rejected);
		else writes.push(result.write);
	}
	const applied = await applyWrites(db, { actor, client, now }, writes);
	rejected.push(...applied.rejected);
	if (rejected.length) reportError(new Error('upload: rejected writes'), 'warning', { rejected });
	return { rejected };
}
