// Plain constants, free of the engine's imports, so the end-to-end specs on Node can read them too.
/** The engine's routes: the client posts to `<endpoint>/sync` and opens `<endpoint>/live`. */
export const SYNC_ENDPOINT = '/api';

/** The web's database in OPFS, one per browser profile. */
export const DATABASE_FILE = 'procrastimate.sqlite';

/**
 * Test only: a `localStorage` key naming another database file. Playwright's WebKit contexts share one OPFS store, so
 * each end-to-end context sets its own; a real browser keeps OPFS per profile and never sets it.
 */
export const DATABASE_FILE_KEY = 'procrastimate-e2e-database-file';

/**
 * A local-only log of every synced row any writer changed, in order: a local write, another tab, a sync, a reset.
 * Both clients read only the rows it names. The engine syncs only its schema's tables, so it never leaves the device.
 */
export const CHANGE_LOG = 'procrastimate_changes';

/** The log and the triggers that fill it, on each synced table. Every statement may run again. */
export function changeLogStatements(tables: readonly string[]): string[] {
	const events = [
		['insert', 'NEW'],
		['update', 'NEW'],
		['delete', 'OLD'],
	] as const;
	return [
		`CREATE TABLE IF NOT EXISTS ${CHANGE_LOG} (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, id TEXT NOT NULL)`,
		...tables.flatMap(table =>
			events.map(
				([event, row]) =>
					`CREATE TRIGGER IF NOT EXISTS ${CHANGE_LOG}_${table}_${event} AFTER ${event.toUpperCase()} ON ${table} BEGIN INSERT INTO ${CHANGE_LOG} (tbl, id) VALUES ('${table}', ${row}.id); END`,
			),
		),
	];
}
