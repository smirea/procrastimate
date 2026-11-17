import { beforeAll, expect, test } from 'bun:test';
import { signUp, testApp, type TestApp } from '../test-app';
import { backupKey, dumpJson, restoreDump } from './backup';

let app: TestApp;
beforeAll(async () => {
	app = await testApp();
});

test('the dump carries every server table and names the day', async () => {
	const owner = await signUp(app, 'Owner');
	const at = new Date('2026-10-18T09:00:00Z');
	const dump = JSON.parse(dumpJson(app.db, at)) as {
		at: string;
		tables: Record<string, Record<string, unknown>[]>;
	};
	expect(dump.at).toBe('2026-10-18T09:00:00.000Z');
	expect(dump.tables.user!.map(user => user.id)).toEqual([owner.person.id]);
	expect(dump.tables.orphans).toEqual([]);
	expect(backupKey(at)).toBe('sqlite/2026-10-18.json');
});

test('a restore refuses a database that already holds a user', async () => {
	const fresh = await testApp();
	await signUp(fresh, 'Here');
	expect(() => restoreDump(fresh.db, { at: '2026-10-18T09:00:00.000Z', tables: {} }, 1)).toThrow(
		'restore: the database already holds users',
	);
});
