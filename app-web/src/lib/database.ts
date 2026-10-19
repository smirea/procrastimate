import { wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver';
import { PowerSyncDatabase } from '@powersync/web';
import { and, eq, getTableName, gt, inArray, lte, max, min } from 'drizzle-orm';
import type { RowsRead, StoredRow, TableRead } from 'shared/local-rows.ts';
import type { Kind } from 'shared/model.ts';
import { KIND_OF, TABLE_OF, type RowWrite, type SyncedTable } from 'shared/rows.ts';
import { AppSchema, changeLog, databaseOwner, localTables, SETUP_STATEMENTS } from './generated/tables.ts';

export const powerSync = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: 'procrastimate.db' } });
const db = wrapPowerSyncWithDrizzle(powerSync, { schema: localTables });

/** The change log's table, which `onChange` watches instead of every synced table. */
export const CHANGE_LOG = getTableName(changeLog);
export type AccessRow = typeof localTables.access.$inferSelect;
/** `cursor` is the newest change the read covers, and `logged` how many changes the log holds. */
export type Read = { cursor: number; full: boolean; logged: number; changes: RowsRead };

/** Past this many entries a reader trims the log to the newest `KEPT_CHANGES`; a tab further behind reads everything. */
const TRIM_ABOVE = 10_000;
const KEPT_CHANGES = 1000;
/** Past this many changed ids a table is read whole, which also keeps its query under SQLite's variable limit. */
const WHOLE_TABLE_ABOVE = 500;

let settingUp: Promise<void> | null = null;

/** Creates the change log, its triggers, and the owner table (`SETUP_STATEMENTS`) once per database; every tab may. */
function setUp(): Promise<void> {
	settingUp ??= powerSync
		.writeTransaction(async tx => {
			for (const statement of SETUP_STATEMENTS) await tx.execute(statement);
		})
		.catch(error => {
			settingUp = null;
			throw error;
		});
	return settingUp;
}

/** Whose rows the database holds, or null for a database no account opened yet. */
export async function storedOwner(): Promise<string | null> {
	await setUp();
	const [row] = await db.select().from(databaseOwner);
	return row?.owner ?? null;
}

/**
 * Names the database `owner`'s, inside the database rather than in `localStorage`: the browser's storage may drop the
 * last commits when a page closes right after them, but never out of order, so this lands only with the clear before it.
 * A name in `localStorage` outlived a lost clear and showed the previous account's rows.
 */
export async function storeOwner(owner: string): Promise<void> {
	await setUp();
	await db.transaction(async tx => {
		await tx.delete(databaseOwner);
		await tx.insert(databaseOwner).values({ owner });
	});
}

const READ_TABLES = [...Object.values(TABLE_OF), 'access'] as const satisfies readonly (SyncedTable | 'access')[];
type ReadTable = (typeof READ_TABLES)[number];
const kindOf = (table: ReadTable): Kind | 'access' => (table === 'access' ? 'access' : KIND_OF[table]);

/**
 * What changed since `cursor`, in one read-only transaction so a sync applying between two tables cannot tear the
 * result: the ids the log names and the rows that still have them. Every table whole when there is no cursor yet or
 * the log no longer reaches back to it.
 */
export async function readSince(cursor: number | null): Promise<Read> {
	await setUp();
	return db.transaction(
		async tx => {
			const [bounds] = await tx.select({ first: min(changeLog.seq), last: max(changeLog.seq) }).from(changeLog);
			const last = bounds?.last ?? 0;
			const logged = bounds?.first == null ? 0 : last - bounds.first + 1;
			const changes: Record<string, TableRead<StoredRow | AccessRow>> = {};
			if (cursor === null || (bounds?.first != null && bounds.first > cursor + 1)) {
				for (const table of READ_TABLES) {
					changes[kindOf(table)] = { ids: 'all', rows: (await tx.select().from(localTables[table])) as StoredRow[] };
				}
				return { cursor: last, full: true, logged, changes: changes as RowsRead };
			}
			if (last <= cursor) return { cursor, full: false, logged, changes: {} };
			const named = await tx
				.selectDistinct({ tbl: changeLog.tbl, id: changeLog.id })
				.from(changeLog)
				.where(and(gt(changeLog.seq, cursor), lte(changeLog.seq, last)));
			for (const [table, entries] of Map.groupBy(named, entry => entry.tbl as ReadTable)) {
				const columns = localTables[table];
				const ids = entries.map(entry => entry.id);
				changes[kindOf(table)] =
					ids.length > WHOLE_TABLE_ABOVE
						? { ids: 'all', rows: (await tx.select().from(columns)) as StoredRow[] }
						: { ids, rows: (await tx.select().from(columns).where(inArray(columns.id, ids))) as StoredRow[] };
			}
			return { cursor: last, full: false, logged, changes: changes as RowsRead };
		},
		{ accessMode: 'read only' },
	);
}

/** Trims the log once it is long; every reader may, and trimming twice is harmless. */
export async function trimChanges({ cursor, logged }: Read): Promise<void> {
	if (logged <= TRIM_ABOVE) return;
	await db.delete(changeLog).where(lte(changeLog.seq, cursor - KEPT_CHANGES));
}

/**
 * PowerSync's tables are views that refuse an upsert, so a put of a row that is already here, as after a reload raced
 * the command, updates it instead.
 */
export function writeRows(owner: string, writes: readonly RowWrite[]): Promise<void> {
	return db.transaction(async tx => {
		// One select per kind says which puts update, kept current as the batch inserts and deletes.
		const stored = new Map<Kind, Set<string>>();
		for (const [kind, group] of Map.groupBy(
			writes.filter(write => write.op === 'put'),
			write => write.kind,
		)) {
			const table = localTables[TABLE_OF[kind]];
			const ids = [...new Set(group.map(write => write.id))];
			const found = new Set<string>();
			for (let at = 0; at < ids.length; at += WHOLE_TABLE_ABOVE) {
				const rows = await tx
					.select({ id: table.id })
					.from(table)
					.where(inArray(table.id, ids.slice(at, at + WHOLE_TABLE_ABOVE)));
				for (const row of rows) found.add(row.id);
			}
			stored.set(kind, found);
		}
		for (const { op, kind, id, values } of writes) {
			const table = localTables[TABLE_OF[kind]];
			const where = eq(table.id, id);
			if (op === 'delete') {
				await tx.delete(table).where(where);
				stored.get(kind)?.delete(id);
				continue;
			}
			if (op === 'patch' || stored.get(kind)?.has(id)) {
				await tx.update(table).set(values!).where(where);
			} else {
				await tx.insert(table).values({ ...values, id, userId: owner } as never);
				stored.get(kind)?.add(id);
			}
		}
	});
}
