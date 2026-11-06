import { createSpace, type Space, type SqlDriver } from 'sync-engine/core';
import { syncSchema } from '../../../shared/db/sync';
import { syncHooks, type SyncContext } from '../writes';
import { migrateServer, serverStatements } from './migrate';
import type { Db } from './sqlite';

/**
 * The server's one database, three ways in: Drizzle for the app's queries, the engine's driver, and the engine's space
 * over the synced tables with the app's hooks. All three share one SQLite connection, so the engine's transaction
 * covers what the hooks write through Drizzle.
 */
export type Store = { db: Db; driver: SqlDriver; space: Space<SyncContext> };

export function openStore(db: Db, driver: SqlDriver): Store {
	const space = createSpace(driver, syncSchema, { hooks: syncHooks(db, driver) });
	if (appliedFingerprint(driver) !== schemaFingerprint()) {
		space.migrate();
		migrateServer(driver);
		driver.exec('CREATE TABLE IF NOT EXISTS _schema_fingerprint (fingerprint TEXT NOT NULL)');
		driver.exec('DELETE FROM _schema_fingerprint');
		driver.exec('INSERT INTO _schema_fingerprint (fingerprint) VALUES (?)', [schemaFingerprint()]);
	}
	return { db, driver, space };
}

/**
 * The Durable Object rebuilds itself on every wake from hibernation, which in production is most requests: the minute
 * cron and each client's minute pull find it idle. Both migrations ran dozens of statements per wake, about a fifth of
 * a wake's CPU, so they run only when the statements they would run changed. The fingerprint covers exactly those:
 * the engine's DDL for both sides and every statement of the server's migration.
 */
let fingerprint: string | null = null;
function schemaFingerprint(): string {
	if (fingerprint) return fingerprint;
	const text = JSON.stringify([syncSchema.ddl, serverStatements()]);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
	fingerprint = `${(hash >>> 0).toString(16)}-${text.length}`;
	return fingerprint;
}

function appliedFingerprint(driver: SqlDriver): string | null {
	const exists = driver.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_schema_fingerprint'");
	if (!exists.length) return null;
	return (driver.exec('SELECT fingerprint FROM _schema_fingerprint')[0]?.fingerprint as string | undefined) ?? null;
}
