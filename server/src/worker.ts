import type { ScheduledController } from '@cloudflare/workers-types';
import { instrumentDurableObjectWithSentry, withSentry } from '@sentry/cloudflare';
import { Account as AccountObject } from './account/account';
import api from './api';
import type { Env } from './bindings';
import { config } from './config';
import { backupTurso } from './db/backup';
import { sentryOptions } from './sentry';

/** The Cloudflare entry `wrangler.jsonc` names. The Bun dev server serves `api.ts` without Sentry. */

export const Account = instrumentDurableObjectWithSentry(sentryOptions, AccountObject);

/** The one Cron Trigger, the daily backup. A throw reaches Sentry and marks the cron check-in failed. */
async function scheduled(controller: ScheduledController, env: Env) {
	const { turso } = config(env);
	if (!turso) return;
	if (!env.BACKUPS) throw new Error('The BACKUPS R2 binding is missing');
	console.log(`Backed up Turso to ${await backupTurso(turso, env.BACKUPS, new Date(controller.scheduledTime))}`);
}

// A copy, because `withSentry` patches the handler object it is given.
export default withSentry(sentryOptions, { fetch: api.fetch, scheduled });
