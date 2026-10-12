import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrations } from './generated/migrations';
import { migrateSync } from './migrate';
import { localClient } from './test-turso';
import { openDatabase } from './turso';

const tableNames = (rows: { name: string }[]) => rows.map(row => row.name).sort();
const TABLES = sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'`;
const expected = () => {
	const db = drizzle(new Database(':memory:'));
	migrateSync(db);
	return tableNames(db.all<{ name: string }>(TABLES));
};

describe('migrating a libSQL database', () => {
	test('a database from before Drizzle is wiped and rebuilt, foreign keys and all', async () => {
		const legacy = localClient();
		await legacy.executeMultiple(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE "user" (id TEXT PRIMARY KEY);
			CREATE TABLE session (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES "user" (id));
			CREATE TABLE entities (user_id TEXT, kind TEXT, id TEXT, data TEXT, clocks TEXT);
			INSERT INTO "user" VALUES ('u1');
			INSERT INTO session VALUES ('s1', 'u1');
			INSERT INTO entities VALUES ('u1', 'task', 't1', '{}', '{}');
		`);
		const db = await openDatabase(legacy);
		expect(tableNames(await db.all<{ name: string }>(TABLES))).toEqual(expected());
		expect(await db.all(sql`SELECT * FROM "user"`)).toEqual([]);
		expect(await db.all(sql`SELECT * FROM session`)).toEqual([]);
	});

	test('a rebuild that failed after the bookkeeping table was made runs again', async () => {
		const client = localClient();
		await client.executeMultiple(`
			CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
			CREATE TABLE devices (id TEXT PRIMARY KEY);
		`);
		const db = await openDatabase(client);
		expect(tableNames(await db.all<{ name: string }>(TABLES))).toEqual(expected());
	});

	test('a database migrated by another history is wiped, and one on this history keeps its rows', async () => {
		const client = localClient();
		await client.executeMultiple(`
			CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);
			INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES ('', 1);
			CREATE TABLE ramble_budget (day TEXT PRIMARY KEY, seconds REAL NOT NULL);
			INSERT INTO ramble_budget VALUES ('2026-10-14', 99);
		`);
		const db = await openDatabase(client);
		expect(await db.all(sql`SELECT * FROM ramble_budget`)).toEqual([]);
		expect(
			(await db.all<{ at: number }>(sql`SELECT created_at AS at FROM __drizzle_migrations`)).map(row => row.at),
		).toEqual(migrations.map(migration => migration.when));
		await db.run(sql`INSERT INTO ramble_budget VALUES ('2026-10-14', 3)`);
		const again = await openDatabase(client);
		expect(await again.all(sql`SELECT day, seconds FROM ramble_budget`)).toEqual([{ day: '2026-10-14', seconds: 3 }]);
	});
});

test('a Durable Object database from before Drizzle is wiped, then kept', () => {
	const sqlite = new Database(':memory:');
	sqlite.run('CREATE TABLE entities (kind TEXT, id TEXT, data TEXT, clocks TEXT)');
	sqlite.run("INSERT INTO entities VALUES ('task', 't1', '{}', '{}')");
	const db = drizzle(sqlite);
	migrateSync(db);
	expect(tableNames(db.all<{ name: string }>(TABLES))).toEqual(expected());
	db.run(sql`INSERT INTO ramble_budget VALUES ('2026-10-14', 3)`);
	migrateSync(db);
	expect(db.all(sql`SELECT day, seconds FROM ramble_budget`)).toEqual([{ day: '2026-10-14', seconds: 3 }]);
});
