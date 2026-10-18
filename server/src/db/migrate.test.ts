import { PGlite } from '@electric-sql/pglite';
import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { SpaceView } from '../../../shared/sharing';
import type { ClientStamp } from '../../../shared/values';
import { createApp } from '../app';
import { handle } from '../api';
import { ramble, rambleRoute } from '../ramble';
import { json, ORIGIN, signUp, testEnv, type TestApp } from '../test-app';
import { migrations } from './generated/migrations';
import { migrate, MigrationHistoryError, pending } from './migrate';

describe('migrate', () => {
	test('applies every bundled migration once, including the publication, and is a no-op after', async () => {
		const client = new PGlite();
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
		const client = new PGlite();
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

	test('the apps behind each task survive the move from task_clients onto the log', async () => {
		const client = new PGlite();
		const db = drizzle(client);
		const split = migrations.findIndex(migration => migration.tag === '0002_minimal_writes');
		await db.execute(sql`CREATE SCHEMA drizzle`);
		await db.execute(
			sql`CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
		);
		for (const migration of migrations.slice(0, split)) {
			for (const statement of migration.statements) await db.execute(sql.raw(statement));
			await db.execute(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('', ${migration.when})`);
		}
		const base = await createApp(
			await testEnv(),
			db,
			rambleRoute(
				db,
				ramble(() => new Response(null), { connect: null }),
			),
		);
		const app: TestApp = {
			...base,
			fetch: (path, init) => handle(new Request(`${ORIGIN}${path}`, init), base),
			close: () => client.close(),
			statements: [],
		};
		const owner = await signUp(app, 'Owner');
		const me = owner.person.id;
		const app_ = (kind: 'web' | 'ios' | 'api', device: string) => ({
			kind,
			version: '1.0',
			device,
			os: 'test',
			timeZone: 'UTC',
		});
		const [edited, once, imported] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
		const stamps: Record<string, { created: ClientStamp | null; edited: ClientStamp }> = {
			[edited]: { created: { ...app_('web', 'Chrome'), at: 10 }, edited: { ...app_('ios', 'iPhone17,1'), at: 30 } },
			[once]: { created: { ...app_('api', 'curl/8.1'), at: 40 }, edited: { ...app_('api', 'curl/8.1'), at: 40 } },
			[imported]: { created: null, edited: { ...app_('ios', 'iPad'), at: 60 } },
		};
		const logRows: [string, string, number][] = [
			[edited, 'put', 10],
			[edited, 'patch', 20],
			[edited, 'patch', 30],
			[once, 'put', 40],
			[imported, 'put', 50],
			[imported, 'patch', 60],
		];
		for (const [id, title] of [
			[edited, 'Edited twice'],
			[once, 'Written once'],
			[imported, 'Imported'],
		]) {
			await db.execute(sql`INSERT INTO tasks (id, user_id, title, created_at) VALUES (${id}, ${me}, ${title}, ${1})`);
			const { created, edited: last } = stamps[id!]!;
			await db.execute(
				sql`INSERT INTO task_clients (user_id, id, created, edited) VALUES (${me}, ${id}, ${created ? JSON.stringify(created) : null}::jsonb, ${JSON.stringify(last)}::jsonb)`,
			);
		}
		for (const [id, op, at] of logRows) {
			await db.execute(
				sql`INSERT INTO log (user_id, kind, id, op, fields, actor, at) VALUES (${me}, 'task', ${id}, ${op}, '{}'::jsonb, ${me}, ${at})`,
			);
		}

		expect(await migrate(db)).toEqual(['0002_minimal_writes']);
		const view = await json<SpaceView>(app.fetch('/api/view', { headers: owner.headers }));
		expect(Object.fromEntries(view.tasks.map(task => [task.id, task.clients]))).toEqual(stamps);
		await client.close();
	});
});
