import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { instrumentDurableObjectWithSentry, withSentry } from '@sentry/cloudflare';
import { handle } from './api';
import { createApp } from './app';
import type { Env } from './bindings';
import { config } from './config';
import { BACKUP_CRON } from './crons';
import { backupDatabase } from './db/backup';
import { migrate } from './db/migrate';
import { connect, type Db } from './db/postgres';
import { sweepImages } from './images';
import { deliverDue, pushSender } from './push';
import type { RambleRoute } from './ramble';
import { Ramble as RambleObject, RAMBLE_ACTOR_HEADER } from './ramble-object';
import { sentryOptions } from './sentry';

/** The Cloudflare entry `wrangler.jsonc` names. The Bun dev server serves `api.ts` without Sentry. */

export const Ramble = instrumentDurableObjectWithSentry(sentryOptions, RambleObject);

let migrated: Promise<unknown> | null = null;

/** Once per isolate, under the migrator's advisory lock, so a deploy's first requests race nobody. */
function migrateOnce(db: Db) {
	migrated ??= migrate(db).catch(error => {
		migrated = null;
		throw error;
	});
	return migrated;
}

/** The request goes to the user's `Ramble` object unread, with the actor the Worker resolved. */
function rambleForward(env: Env): RambleRoute {
	return async (request, actor) => {
		if (!env.RAMBLE) return Response.json({ ok: false, error: 'Ramble is not configured' }, { status: 503 });
		const headers = new Headers(request.headers);
		headers.set(RAMBLE_ACTOR_HEADER, JSON.stringify(actor));
		const stub = env.RAMBLE.get(env.RAMBLE.idFromName(actor.id));
		return stub.fetch(new Request(request, { headers }) as never) as unknown as Promise<Response>;
	};
}

async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	// Before routing, so a misconfigured deploy fails every request with the missing key named.
	const settings = config(env);
	const { db, end } = connect(settings.database);
	try {
		await migrateOnce(db);
		return await handle(request, await createApp(env, db, rambleForward(env)));
	} finally {
		ctx.waitUntil(end());
	}
}

/**
 * Every minute the due pushes go out; at 09:00 UTC the database is dumped to R2 and the orphaned image bytes are
 * swept. A throw marks the cron check-in failed.
 */
async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
	const settings = config(env);
	const { db, end } = connect(settings.database);
	try {
		await migrateOnce(db);
		const at = new Date(controller.scheduledTime);
		if (controller.cron === BACKUP_CRON) {
			if (!env.BACKUPS) throw new Error('The BACKUPS R2 binding is missing');
			console.log(`Backed up Postgres to ${await backupDatabase(db, env.BACKUPS, at)}`);
			await sweepImages(db, at.getTime());
			return;
		}
		const sent = await deliverDue(db, at.getTime(), pushSender(env));
		if (sent) console.log(`Delivered ${sent} push notifications`);
	} finally {
		ctx.waitUntil(end());
	}
}

// A copy, because `withSentry` patches the handler object it is given.
export default withSentry(sentryOptions, { fetch, scheduled } as never);
