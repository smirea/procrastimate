import { expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { access, log, settings, shares, tasks } from '../../shared/db/schema';
import { handle } from './api';
import { createApp } from './app';
import { ramble, rambleRoute } from './ramble';
import { ORIGIN, shareWith, signUp, taskRow, type TestApp, testEnv, upload } from './test-app';

/**
 * A share change must wait for the space's advisory lock, which the `access` recompute after an upload holds, and a
 * guest's write must wait for a change to its `access` rows that is still in flight. PGlite has one connection and
 * cannot hold a lock on one while another waits, so these run only against the local Postgres (`DATABASE_URL` from
 * the worktree's `.env.override`) and are skipped elsewhere.
 */

const url = process.env.DATABASE_URL;
if (!url && process.env.CI) throw new Error('The lock tests need DATABASE_URL in CI; the e2e job passes the stack’s.');

async function postgresApp() {
	// More than one connection, or a blocked statement would hold the one the reads need.
	const client = postgres(url!, { max: 4, onnotice: () => {} });
	const db = drizzle(client);
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
		close: () => client.end(),
		statements: [],
	};
	return { app, db };
}

async function cleanUp(db: ReturnType<typeof drizzle>, ids: string[]) {
	for (const table of [tasks, shares, access, log, settings]) {
		const column = table === access ? access.owner : (table as typeof tasks).userId;
		await db.delete(table).where(inArray(column, ids));
	}
	await db.execute(
		sql`DELETE FROM "user" WHERE id IN (${sql.join(
			ids.map(id => sql`${id}`),
			sql`, `,
		)})`,
	);
}

test.skipIf(!url)(
	'a share change waits for the space lock an upload holds, and lands once it is released',
	async () => {
		const holder = postgres(url!, { max: 1, onnotice: () => {} });
		const { app, db } = await postgresApp();
		const owner = await signUp(app, 'Lockowner');
		const guest = await signUp(app, 'Lockguest');
		const ids = [owner.person.id, guest.person.id];
		try {
			const taskId = crypto.randomUUID();
			expect(
				await upload(app, owner, [
					{ op: 'put', table: 'tasks', id: taskId, values: taskRow(taskId, owner.person.id, 'Locked') },
				]),
			).toEqual([]);
			const share = await shareWith(app, owner, { kind: 'task', id: taskId }, guest.person.id, 'view');
			const accessRows = () => db.select().from(access).where(eq(access.grantee, guest.person.id));
			expect(await accessRows()).toHaveLength(1);

			let revoking: Promise<Response> | undefined;
			await holder.begin(async tx => {
				await tx`SELECT pg_advisory_xact_lock(hashtext(${owner.person.id}))`;
				revoking = app.fetch(`/api/shares?id=${share.id}`, { method: 'DELETE', headers: owner.headers });
				const outcome = await Promise.race([revoking.then(() => 'revoked'), Bun.sleep(500).then(() => 'waiting')]);
				expect(outcome).toBe('waiting');
				expect(await accessRows()).toHaveLength(1);
			});
			expect((await revoking!).status).toBe(200);
			expect(await accessRows()).toHaveLength(0);
		} finally {
			await cleanUp(db, ids);
			await holder.end();
			await app.close();
		}
	},
);

test.skipIf(!url)(
	'a guest’s write checks the access rows a downgrade is still changing, and is refused once it commits',
	async () => {
		const holder = postgres(url!, { max: 1, onnotice: () => {} });
		const { app, db } = await postgresApp();
		const owner = await signUp(app, 'Raceowner');
		const guest = await signUp(app, 'Raceguest');
		const ids = [owner.person.id, guest.person.id];
		try {
			const taskId = crypto.randomUUID();
			expect(
				await upload(app, owner, [
					{ op: 'put', table: 'tasks', id: taskId, values: taskRow(taskId, owner.person.id, 'Shared') },
				]),
			).toEqual([]);
			await shareWith(app, owner, { kind: 'task', id: taskId }, guest.person.id, 'edit');

			let writing: Promise<unknown> | undefined;
			// A downgrade as the share routes run it: under the space's lock, rewriting the guest's rows.
			await holder.begin(async tx => {
				await tx`SELECT pg_advisory_xact_lock(hashtext(${owner.person.id}))`;
				await tx`UPDATE access SET role = 'view' WHERE grantee = ${guest.person.id}`;
				writing = upload(app, guest, [{ op: 'patch', table: 'tasks', id: taskId, values: { title: 'Mine' } }]);
				const outcome = await Promise.race([writing.then(() => 'written'), Bun.sleep(500).then(() => 'waiting')]);
				expect(outcome).toBe('waiting');
			});
			expect(await writing).toEqual([{ table: 'tasks', id: taskId, reason: 'Not editable in this share' }]);
			const [row] = await db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, taskId));
			expect(row).toEqual({ title: 'Shared' });
		} finally {
			await cleanUp(db, ids);
			await holder.end();
			await app.close();
		}
	},
);
