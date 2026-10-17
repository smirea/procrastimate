import { createClient, type Client } from '@libsql/client';
import type { R2Bucket } from '@cloudflare/workers-types';
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupKey, dumpSql, pruneBackups } from './backup';
import { openDatabase } from './turso';

const fileClient = () =>
	createClient({ url: `file:${join(tmpdir(), `procrastimate-${crypto.randomUUID()}.db`)}`, intMode: 'bigint' });

async function snapshot(client: Client) {
	const schema = (await client.execute('select type, name, sql from sqlite_master order by name')).rows;
	const tables = schema.filter(row => row.type === 'table').map(row => String(row.name));
	const rows = Object.fromEntries(
		await Promise.all(
			tables.map(async name => [
				name,
				(await client.execute(`select * from "${name}"`)).rows.map(row => Array.from(row)),
			]),
		),
	);
	return { schema: schema.map(row => Array.from(row)), rows };
}

describe('dumpSql', () => {
	test('replays into an empty database as the same schema and rows', async () => {
		const source = fileClient();
		await openDatabase(source, 'rebuild');
		await source.executeMultiple(`
			create table odd ("we""ird" text, n integer, r real, b blob);
			create table counted (id integer primary key autoincrement, v text);
			create index odd_n on odd (n);
			create view odd_view as select n from odd;
			create trigger counted_trigger after insert on counted begin select 1; end;
			insert into odd values ('it''s', 9007199254740993, 2.0, x'00ff10');
			insert into odd values (null, -1, 0.1, null);
			insert into counted (v) values ('a'), ('b'), ('c');
			delete from counted where v = 'c';
		`);
		const before = await snapshot(source);

		const restored = fileClient();
		await restored.executeMultiple(await dumpSql(source));

		expect(await snapshot(restored)).toEqual(before);
		expect(before.rows.odd).toEqual([
			["it's", 9007199254740993n, 2, new Uint8Array([0, 255, 16]).buffer],
			[null, -1n, 0.1, null],
		]);
		expect(before.rows.sqlite_sequence).toEqual([['counted', 3n]]);
		expect(before.rows.__drizzle_migrations!.length).toBeGreaterThan(0);
	});
});

function memoryBucket(keys: string[]) {
	const stored = new Set(keys);
	const bucket = {
		list: async ({ cursor }: { cursor?: string }) => {
			const all = [...stored].sort();
			const start = cursor ? Number(cursor) : 0;
			const page = all.slice(start, start + 7);
			const truncated = start + 7 < all.length;
			return { objects: page.map(key => ({ key })), truncated, cursor: truncated ? String(start + 7) : undefined };
		},
		delete: async (deleted: string[]) => deleted.forEach(key => stored.delete(key)),
	};
	return { bucket: bucket as unknown as R2Bucket, stored };
}

describe('pruneBackups', () => {
	test('keeps the newest 30 daily backups across list pages', async () => {
		const days = Array.from({ length: 33 }, (_, day) => backupKey(new Date(Date.UTC(2026, 8, 20 + day))));
		const { bucket, stored } = memoryBucket(days);

		await pruneBackups(bucket);

		expect(stored.size).toBe(30);
		expect([...stored].sort()[0]).toBe('turso/2026-09-23.sql');
		expect(stored.has('turso/2026-10-22.sql')).toBe(true);
		expect(stored.has('turso/2026-09-22.sql')).toBe(false);
	});

	test('deletes nothing while fewer than 30 exist', async () => {
		const { bucket, stored } = memoryBucket([backupKey(new Date('2026-10-17T09:00:00Z'))]);
		await pruneBackups(bucket);
		expect([...stored]).toEqual(['turso/2026-10-17.sql']);
	});
});
