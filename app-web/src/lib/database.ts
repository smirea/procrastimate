import { wrapPowerSyncWithDrizzle } from '@powersync/drizzle-driver';
import { PowerSyncDatabase } from '@powersync/web';
import { and, eq, getTableName, gt, inArray, lte, max, min } from 'drizzle-orm';
import type { RowsRead, StoredRow, TableRead } from 'shared/local-rows.ts';
import type { Kind } from 'shared/model.ts';
import { KIND_OF, TABLE_OF, type RowWrite, type SyncedTable } from 'shared/rows.ts';
import { AppSchema, CHANGE_LOG_STATEMENTS, changeLog, localTables } from './generated/tables.ts';

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

let logging: Promise<void> | null = null;

/** Creates the change log and its triggers (`CHANGE_LOG_STATEMENTS`) once per database; every tab may, harmlessly. */
function logChanges(): Promise<void> {
	logging ??= powerSync
		.writeTransaction(async tx => {
			for (const statement of CHANGE_LOG_STATEMENTS) await tx.execute(statement);
		})
		.catch(error => {
			logging = null;
			throw error;
		});
	return logging;
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
	await logChanges();
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
		for (const { op, kind, id, values } of writes) {
			const table = localTables[TABLE_OF[kind]];
			const where = eq(table.id, id);
			if (op === 'delete') {
				await tx.delete(table).where(where);
				continue;
			}
			const exists = op === 'patch' || (await tx.select({ id: table.id }).from(table).where(where)).length > 0;
			if (exists) await tx.update(table).set(values!).where(where);
			else await tx.insert(table).values({ ...values, id, userId: owner } as never);
		}
	});
}
