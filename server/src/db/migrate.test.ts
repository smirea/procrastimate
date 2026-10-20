import { PGlite } from '@electric-sql/pglite';
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrations } from './generated/migrations';
import { migrate, MigrationHistoryError, pending } from './migrate';
import { emptySnapshot } from './pglite-snapshot';

describe('migrate', () => {
	test('applies every bundled migration once, including the publication, and is a no-op after', async () => {
		const client = new PGlite({ loadDataDir: emptySnapshot() });
		const db = drizzle(client);
		expect(await migrate(db)).toEqual(migrations.map(migration => migration.tag));
		expect(await migrate(db)).toEqual([]);
		const publications = await client.query<{ pubname: string }>('select pubname from pg_publication');
		expect(publications.rows.map(row => row.pubname)).toEqual(['powersync']);
		const applied = await client.query<{ created_at: string }>(
			'select created_at from drizzle.__drizzle_migrations order by created_at',
		);
		expect(applied.rows.map(row => Number(row.created_at))).toEqual(migrations.map(migration => migration.when));
		await client.close();
	});

	test('refuses a database whose history is not a prefix of ours, without touching it', async () => {
		const client = new PGlite({ loadDataDir: emptySnapshot() });
		const db = drizzle(client);
		await db.execute(sql`CREATE TABLE stranger (id text)`);
		await expect(migrate(db)).rejects.toBeInstanceOf(MigrationHistoryError);
		const tables = await client.query<{ tablename: string }>(
			"select tablename from pg_tables where schemaname = 'public'",
		);
		expect(tables.rows.map(row => row.tablename)).toEqual(['stranger']);
		await client.close();
	});

	test('the prefix rule', () => {
		const whens = migrations.map(migration => migration.when);
		expect(pending([], []).map(m => m.tag)).toEqual(migrations.map(m => m.tag));
		expect(pending(whens, ['tasks'])).toEqual([]);
		expect(pending(whens.slice(0, 1), ['tasks']).map(m => m.tag)).toEqual(migrations.slice(1).map(m => m.tag));
		expect(() => pending([123], ['tasks'])).toThrow(MigrationHistoryError);
		expect(() => pending([], ['tasks'])).toThrow('found none, with tables tasks');
	});
});
