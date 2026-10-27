import { and, eq, getTableName, gt, inArray, lte, max, min } from 'drizzle-orm';
import { integer, sqliteTable, text, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { drizzleSyncDatabase, openSyncDatabase, type WebDatabase } from 'sync-engine/client-web';
import workerUrl from './sync/worker.ts?worker&url';
import { access, comments, labels, projects, reads, sections, settings, tasks } from 'shared/db/schema.ts';
import { DATABASE_FILE_KEY } from 'shared/local-database.ts';
import type { RowsRead, StoredRow, TableRead } from 'shared/local-rows.ts';
import type { Kind } from 'shared/model.ts';
import { entityIdOf, KIND_OF, rowIdOf, TABLE_OF, type RowWrite, type SyncedTable } from 'shared/rows.ts';
import { client } from './api.ts';

/**
 * The browser's database: sync-engine's SQLite in OPFS, one per browser profile, held by one tab's worker and shared
 * by every tab. Drizzle runs on it through the engine's proxy; the engine's triggers capture every write for sync.
 */
let opened: WebDatabase | null = null;

/**
 * The worker starts on first use, so a browser that refuses it (a locked-down profile, private browsing in some)
 * fails that use, which the store reports as a database it could not open, instead of failing the page's imports.
 */
function open(): WebDatabase {
	const query = new URLSearchParams({
		client: JSON.stringify(client()),
		file: localStorage.getItem(DATABASE_FILE_KEY) ?? '',
	});
	opened ??= openSyncDatabase({ worker: new Worker(`${workerUrl}?${query}`, { type: 'module' }) });
	return opened;
}

const listen =
	<A extends unknown[]>(subscribe: (database: WebDatabase) => (...args: A) => () => void) =>
	(...args: A): (() => void) => {
		try {
			return subscribe(open())(...args);
		} catch {
			return () => {};
		}
	};

export const localDatabase: WebDatabase = {
	exec: async (...args) => open().exec(...args),
	batch: async statements => open().batch(statements),
	sync: async () => open().sync(),
	status: async () => open().status(),
	setToken: async token => open().setToken(token),
	reset: async () => open().reset(),
	onChange: listen(database => database.onChange),
	onStatus: listen(database => database.onStatus),
	close: async () => opened?.close(),
};
const db = drizzleSyncDatabase(localDatabase);

export const localTables = { tasks, projects, sections, labels, comments, reads, settings, access } as const;
export type AccessRow = typeof access.$inferSelect;

/**
 * Every row change any writer made, in order: this tab, another tab, a sync, or a reset. Local only: the engine syncs
 * only its schema's tables. Triggers fill it, so a reader reads only what changed.
 */
const changeLog = sqliteTable('procrastimate_changes', {
	seq: integer('seq').primaryKey({ autoIncrement: true }),
	tbl: text('tbl').notNull(),
	id: text('id').notNull(),
});
export const CHANGE_LOG = getTableName(changeLog);

/** Whose rows the database holds. Local only, like the change log. */
const databaseOwner = sqliteTable('procrastimate_owner', { owner: text('owner').primaryKey() });

const SETUP_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS ${CHANGE_LOG} (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, id TEXT NOT NULL)`,
	'CREATE TABLE IF NOT EXISTS procrastimate_owner (owner TEXT PRIMARY KEY)',
	...Object.keys(localTables).flatMap(table =>
		(
			[
				['insert', 'NEW'],
				['update', 'NEW'],
				['delete', 'OLD'],
			] as const
		).map(
			([event, row]) =>
				`CREATE TRIGGER IF NOT EXISTS ${CHANGE_LOG}_${table}_${event} AFTER ${event.toUpperCase()} ON ${table} BEGIN INSERT INTO ${CHANGE_LOG} (tbl, id) VALUES ('${table}', ${row}.id); END`,
		),
	),
];

/** `cursor` is the newest change the read covers, and `logged` how many changes the log holds. */
export type Read = { cursor: number; full: boolean; logged: number; changes: RowsRead };

/** Past this many entries a reader trims the log to the newest `KEPT_CHANGES`; a tab further behind reads everything. */
const TRIM_ABOVE = 10_000;
const KEPT_CHANGES = 1000;

let settingUp: Promise<void> | null = null;

/** Creates the change log, its triggers, and the owner table once per database; every tab may. */
function setUp(): Promise<void> {
	settingUp ??= localDatabase
		.batch(SETUP_STATEMENTS.map(statement => ({ sql: statement })))
		.then(() => {})
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
 * last commits when a page closes right after them, but never out of order, so this lands only with the reset before
 * it. A name in `localStorage` outlived a lost clear and showed the previous account's rows.
 */
export async function storeOwner(owner: string): Promise<void> {
	await setUp();
	await db.batch([db.delete(databaseOwner), db.insert(databaseOwner).values({ owner })]);
}

/** Empties the synced tables, the outbox, and the change log for every tab, so the next account starts fresh. */
export async function clearDatabase(): Promise<void> {
	await setUp();
	// The loop may still hold the previous account's token, and a pull after the reset would bring its rows back.
	await localDatabase.setToken(null);
	await localDatabase.reset();
	await db.delete(changeLog);
}

type ReadTable = keyof typeof localTables;
const READ_TABLES = Object.keys(localTables) as ReadTable[];
const kindOf = (table: ReadTable): Kind | 'access' => (table === 'access' ? 'access' : KIND_OF[table as SyncedTable]);

/** The per-user kinds keep the owner in their row ids; the store keys them as the domain does. */
function asEntityRows(kind: Kind | 'access', me: string, read: TableRead<StoredRow | AccessRow>) {
	if (kind !== 'read' && kind !== 'settings') return read;
	const rows = (read.rows as StoredRow[]).map(row => ({ ...row, id: entityIdOf(kind, row.id, row.userId) }));
	const ids = read.ids === 'all' ? read.ids : read.ids.map(id => entityIdOf(kind, id, me));
	return { ids, rows };
}

/**
 * What changed since `cursor`, in one transaction (the engine's `batch`) so a sync applying between two tables cannot
 * tear the result: the log's bounds, and the rows of each table the log names past the cursor. Every table whole when
 * there is no cursor yet or the log no longer reaches back to it.
 */
export async function readSince(cursor: number | null, me: string): Promise<Read> {
	await setUp();
	const bounds = db.select({ first: min(changeLog.seq), last: max(changeLog.seq) }).from(changeLog);
	const after = cursor ?? 0;
	const named = db
		.selectDistinct({ tbl: changeLog.tbl, id: changeLog.id })
		.from(changeLog)
		.where(gt(changeLog.seq, after));
	const tableRows = READ_TABLES.map(table => {
		const columns = localTables[table] as SQLiteTable & { id: typeof tasks.id };
		const changed = db
			.select({ id: changeLog.id })
			.from(changeLog)
			.where(and(eq(changeLog.tbl, table), gt(changeLog.seq, after)));
		return cursor === null ? db.select().from(columns) : db.select().from(columns).where(inArray(columns.id, changed));
	});
	const [[range], ids, ...rows] = (await db.batch([bounds, named, ...tableRows] as never)) as [
		{ first: number | null; last: number | null }[],
		{ tbl: string; id: string }[],
		...StoredRow[][],
	];
	const last = range?.last ?? 0;
	const logged = range?.first == null ? 0 : last - range.first + 1;
	const full = cursor === null || (range?.first != null && range.first > cursor + 1);
	if (full && cursor !== null) return readSince(null, me);
	const changes: Record<string, TableRead<StoredRow | AccessRow>> = {};
	const byTable = Map.groupBy(ids, entry => entry.tbl as ReadTable);
	READ_TABLES.forEach((table, index) => {
		const tableIds = full ? 'all' : byTable.get(table)?.map(entry => entry.id);
		if (!tableIds) return;
		const kind = kindOf(table);
		changes[kind] = asEntityRows(kind, me, { ids: tableIds, rows: rows[index]! });
	});
	return { cursor: full ? last : Math.max(last, after), full, logged, changes: changes as RowsRead };
}

/** Trims the log once it is long; every reader may, and trimming twice is harmless. */
export async function trimChanges({ cursor, logged }: Read): Promise<void> {
	if (logged <= TRIM_ABOVE) return;
	await db.delete(changeLog).where(lte(changeLog.seq, cursor - KEPT_CHANGES));
}

/**
 * One command's rows in one transaction. A put upserts, so one of a row already here, as after a reload raced the
 * command, updates it; the engine's triggers then record only the columns that changed.
 */
export async function writeRows(owner: string, writes: readonly RowWrite[]): Promise<void> {
	if (!writes.length) return;
	const statements = writes.map(({ op, kind, id: entityId, values }) => {
		const table = localTables[TABLE_OF[kind]] as typeof tasks;
		const id = rowIdOf(kind, entityId, owner);
		if (op === 'delete') return db.delete(table).where(eq(table.id, id));
		if (op === 'patch') return db.update(table).set(values!).where(eq(table.id, id));
		const row = { ...values, id, userId: owner };
		return db
			.insert(table)
			.values(row as never)
			.onConflictDoUpdate({ target: table.id, set: values as never });
	});
	await db.batch(statements as never);
}

/** Every task with a write the server has not acknowledged, with the oldest such write's sequence. */
export async function queuedTasks(): Promise<{ id: string; row: number }[]> {
	const { rows } = await localDatabase.exec(
		`SELECT id, MIN(seq) AS row FROM _outbox WHERE "table" = 'tasks' GROUP BY id`,
	);
	return rows.map(([id, row]) => ({ id: String(id), row: Number(row) }));
}
