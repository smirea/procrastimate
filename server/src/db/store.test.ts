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
	const ddl = (statements: string[]) => statements.filter(sql => /^\s*(CREATE|ALTER|DROP)\b/i.test(sql));
	expect(ddl(reopened.statements)).toEqual([]);

	store.driver.exec("UPDATE _schema_fingerprint SET fingerprint = 'an older schema'");
	const changed = counting(store.driver);
	openStore(store.db, changed.counted);
	expect(ddl(changed.statements).some(sql => sql.includes('"log"'))).toBe(true);
	const again = counting(store.driver);
	openStore(store.db, again.counted);
	expect(ddl(again.statements)).toEqual([]);
});
