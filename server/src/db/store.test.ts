import { expect, test } from 'bun:test';
import type { SqlDriver } from 'sync-engine/core';
import { bunStore } from './bun-store';
import { openStore } from './store';

const counting = (driver: SqlDriver) => {
	const statements: string[] = [];
	const counted: SqlDriver = {
		exec: (sql, params) => {
			statements.push(sql);
			return driver.exec(sql, params);
		},
		transaction: fn => driver.transaction(fn),
	};
	return { counted, statements };
};

test('a woken object skips both migrations while the schema is unchanged, and runs them when it changed', () => {
	const store = bunStore(':memory:');
	const reopened = counting(store.driver);
	openStore(store.db, reopened.counted);
	expect(reopened.statements).toEqual([
		"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_schema_fingerprint'",
		'SELECT fingerprint FROM _schema_fingerprint',
	]);

	store.driver.exec("UPDATE _schema_fingerprint SET fingerprint = 'an older schema'");
	const changed = counting(store.driver);
	openStore(store.db, changed.counted);
	expect(changed.statements.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS "log"'))).toBe(true);
	expect(changed.statements.at(-1)).toBe('INSERT INTO _schema_fingerprint (fingerprint) VALUES (?)');
});
