import { expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { access, log, people, settings, shares, tasks } from '../../shared/db/schema';
import type { ShareView } from '../../shared/sharing';
import { handle } from './api';
import { createApp } from './app';
import { user } from './db/auth-schema';
import { ramble, rambleRoute } from './ramble';
import { ORIGIN, signUp, taskRow, testEnv, upload, type TestApp } from './test-app';

/**
 * A share change must wait for the space's advisory lock, which an upload holds while it recomputes `access`. PGlite
 * has one connection and cannot hold a lock on one while another waits, so this runs only against the local Postgres
 * (`DATABASE_URL` from the worktree's `.env.override`) and is skipped elsewhere.
 */

const url = process.env.DATABASE_URL;

test.skipIf(!url)(
	'a share change waits for the space lock an upload holds, and lands once it is released',
	async () => {
		const holder = postgres(url!, { max: 1, onnotice: () => {} });
		// More than one connection, or the blocked revoke would hold the one the reads below need.
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
		};
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
			const share = (await (
				await app.fetch('/api/shares', {
					method: 'POST',
					headers: owner.headers,
					body: JSON.stringify({
						target: { kind: 'task', id: taskId },
						audience: { kind: 'user', userId: guest.person.id, role: 'view' },
					}),
				})
			).json()) as ShareView;
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
			for (const table of [tasks, shares, people, access, log, settings]) {
				const column = table === access ? access.owner : (table as typeof tasks).userId;
				await db.delete(table).where(inArray(column, ids));
			}
			await db.execute(
				sql`DELETE FROM "user" WHERE id IN (${sql.join(
					ids.map(id => sql`${id}`),
					sql`, `,
				)})`,
			);
			await db.select().from(user).where(inArray(user.id, ids));
			await holder.end();
			await app.close();
		}
	},
);
