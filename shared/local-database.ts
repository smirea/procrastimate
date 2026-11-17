/** The engine's routes: the client posts to `<endpoint>/sync` and opens `<endpoint>/live`. */
export const SYNC_ENDPOINT = '/api';

/** The web's database in OPFS, one per browser profile. */
export const DATABASE_FILE = 'procrastimate.sqlite';

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
