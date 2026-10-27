import { createSpace, type Space, type SqlDriver } from 'sync-engine/core';
import { syncSchema } from '../../../shared/db/sync';
import { syncHooks, type SyncContext } from '../writes';
import { migrateServer } from './migrate';
import type { Db } from './sqlite';

/**
 * The server's one database, three ways in: Drizzle for the app's queries, the engine's driver, and the engine's space
 * over the synced tables with the app's hooks. All three share one SQLite connection, so the engine's transaction
 * covers what the hooks write through Drizzle.
 */
export type Store = { db: Db; driver: SqlDriver; space: Space<SyncContext> };

export function openStore(db: Db, driver: SqlDriver): Store {
	const space = createSpace(driver, syncSchema, { hooks: syncHooks(db, driver) });
	space.migrate();
	migrateServer(driver);
	return { db, driver, space };
}
