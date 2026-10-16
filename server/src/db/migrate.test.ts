import type { Client } from '@libsql/client';
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrations } from './generated/migrations';
import { migrateSync, MigrationHistoryError } from './migrate';
import { localClient } from './test-turso';
import { openDatabase } from './turso';

const tableNames = (rows: { name: string }[]) => rows.map(row => row.name).sort();
const TABLES = sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'`;
const expected = () => {
	const db = drizzle(new Database(':memory:'));
	migrateSync(db, 'rebuild');
	return tableNames(db.all<{ name: string }>(TABLES));
};
const history = migrations.map(migration => migration.when);
const BOOKKEEPING = 'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)';

async function snapshot(client: Client) {
	const listed = await client.execute(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'`,
	);
	const tables = listed.rows.map(row => String(row.name)).sort();
	const rows = await Promise.all(
		tables.map(async table => [table, JSON.stringify((await client.execute(`SELECT * FROM "${table}"`)).rows)]),
	);
	return Object.fromEntries(rows);
}

async function failsUntouched(client: Client, found: number[]) {
	const before = await snapshot(client);
	const error = await openDatabase(client, 'strict').then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(MigrationHistoryError);
	expect((error as MigrationHistoryError).expected).toEqual(history);
	expect((error as MigrationHistoryError).found).toEqual(found);
	expect(await snapshot(client)).toEqual(before);
	return error as MigrationHistoryError;
}

describe('migrating a persistent libSQL database', () => {
	test('a database migrated by another history fails and keeps every table and row', async () => {
		const client = localClient();
		await client.executeMultiple(`
			${BOOKKEEPING};
			INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES ('', 1);
			CREATE TABLE ramble_budget (day TEXT PRIMARY KEY, seconds REAL NOT NULL);
			INSERT INTO ramble_budget VALUES ('2026-10-14', 99);
		`);
		const error = await failsUntouched(client, [1]);
		expect(error.message).toBe(
			"The database's migration history is not a prefix of server/drizzle, so nothing was migrated or dropped. " +
				`Expected a prefix of [${history.join(', ')}], found [1].`,
		);
	});

	test('a database ahead of the code, as a branch with a new migration leaves it, fails untouched', async () => {
		const client = localClient();
		await openDatabase(client, 'strict');
		await client.execute(`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES ('', 9999999999999)`);
		await client.execute(`INSERT INTO ramble_budget VALUES ('2026-10-14', 3)`);
		await failsUntouched(client, [...history, 9999999999999]);
	});

	test('a database from before Drizzle fails without gaining a bookkeeping table', async () => {
		const client = localClient();
		await client.executeMultiple(`
			CREATE TABLE "user" (id TEXT PRIMARY KEY);
			INSERT INTO "user" VALUES ('u1');
		`);
		const error = await failsUntouched(client, []);
		expect(error.message).toEndWith('found none, with tables user.');
	});

	test('a database on a prefix of the history gets the rest and keeps its rows', async () => {
		const [first] = migrations;
		if (!first) throw new Error('No migrations');
		const client = localClient();
		await client.execute(BOOKKEEPING);
		for (const statement of first.statements) await client.execute(statement);
		await client.execute({
			sql: `INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES ('', ?)`,
			args: [first.when],
		});
		await client.execute(`INSERT INTO ramble_budget VALUES ('2026-10-14', 3)`);
		const db = await openDatabase(client, 'strict');
		expect(tableNames(await db.all<{ name: string }>(TABLES))).toEqual(expected());
		expect(await db.all(sql`SELECT day, seconds FROM ramble_budget`)).toEqual([{ day: '2026-10-14', seconds: 3 }]);
		expect(
			(await db.all<{ at: number }>(sql`SELECT created_at AS at FROM __drizzle_migrations`)).map(row => row.at),
		).toEqual(history);
	});
});

describe('rebuilding a throwaway libSQL database', () => {
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
		const db = await openDatabase(legacy, 'rebuild');
		expect(tableNames(await db.all<{ name: string }>(TABLES))).toEqual(expected());
		expect(await db.all(sql`SELECT * FROM "user"`)).toEqual([]);
		expect(await db.all(sql`SELECT * FROM session`)).toEqual([]);
	});

	test('a rebuild that failed after the bookkeeping table was made runs again', async () => {
		const client = localClient();
		await client.executeMultiple(`
			${BOOKKEEPING};
			CREATE TABLE devices (id TEXT PRIMARY KEY);
		`);
		const db = await openDatabase(client, 'rebuild');
		expect(tableNames(await db.all<{ name: string }>(TABLES))).toEqual(expected());
	});

	test('a database migrated by another history is wiped, and one on this history keeps its rows', async () => {
		const client = localClient();
		await client.executeMultiple(`
			${BOOKKEEPING};
			INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES ('', 1);
			CREATE TABLE ramble_budget (day TEXT PRIMARY KEY, seconds REAL NOT NULL);
			INSERT INTO ramble_budget VALUES ('2026-10-14', 99);
		`);
		const db = await openDatabase(client, 'rebuild');
		expect(await db.all(sql`SELECT * FROM ramble_budget`)).toEqual([]);
		expect(
			(await db.all<{ at: number }>(sql`SELECT created_at AS at FROM __drizzle_migrations`)).map(row => row.at),
		).toEqual(history);
		await db.run(sql`INSERT INTO ramble_budget VALUES ('2026-10-14', 3)`);
		const again = await openDatabase(client, 'rebuild');
		expect(await again.all(sql`SELECT day, seconds FROM ramble_budget`)).toEqual([{ day: '2026-10-14', seconds: 3 }]);
	});
});

describe('migrating a Durable Object database', () => {
	const legacy = () => {
		const sqlite = new Database(':memory:');
		sqlite.run('CREATE TABLE entities (kind TEXT, id TEXT, data TEXT, clocks TEXT)');
		sqlite.run("INSERT INTO entities VALUES ('task', 't1', '{}', '{}')");
		return drizzle(sqlite);
	};

	test('strict, one from before Drizzle fails and keeps its rows', () => {
		const db = legacy();
		expect(() => migrateSync(db, 'strict')).toThrow(MigrationHistoryError);
		expect(tableNames(db.all<{ name: string }>(TABLES))).toEqual(['entities']);
		expect(db.all(sql`SELECT id FROM entities`)).toEqual([{ id: 't1' }]);
	});

	test('rebuilding, one from before Drizzle is wiped, then kept', () => {
		const db = legacy();
		migrateSync(db, 'rebuild');
		expect(tableNames(db.all<{ name: string }>(TABLES))).toEqual(expected());
		db.run(sql`INSERT INTO ramble_budget VALUES ('2026-10-14', 3)`);
		migrateSync(db, 'strict');
		expect(db.all(sql`SELECT day, seconds FROM ramble_budget`)).toEqual([{ day: '2026-10-14', seconds: 3 }]);
	});
});
