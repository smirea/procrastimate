import * as Sentry from '@sentry/bun';
import { sentryRelease } from '../../scripts/sentry-release.mts';
import type { Env } from './bindings';
import { config } from './config';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { restoreDump } from './db/backup';
import { bunStore } from './db/bun-store';
import { serveDev } from './dev-server';
import env from './env';
import { serverOptions } from './sentry';
import { generateVapidKeys } from './web-push';

/**
 * The Bun entry. Values env-manager leaves empty get local stand-ins: a fixed auth secret, no sign-in rate limit, and
 * a fresh VAPID pair per start. The database is a git-ignored SQLite file in `.data/`, one per checkout, so worktrees
 * never share one; `PROCRASTIMATE_DATABASE` names another file, or `:memory:`, and `PROCRASTIMATE_RESTORE` a dump to
 * load into it while it holds no user.
 */

const INSECURE_DEV_AUTH_SECRET = 'insecure-local-dev-better-auth-secret-0123456789';

const { API_PORT, ...secrets } = env;
const bindings: Env = {
	...secrets,
	BETTER_AUTH_SECRET: secrets.BETTER_AUTH_SECRET ?? INSECURE_DEV_AUTH_SECRET,
	// Local sign-ups come in bursts from one address: every smoke run, every e2e worker, every agent's test user.
	AUTH_RATE_LIMIT: secrets.AUTH_RATE_LIMIT ?? 'off',
	SENTRY_RELEASE: sentryRelease(secrets.SENTRY_ENVIRONMENT, secrets.SENTRY_RELEASE),
};
if (!bindings.VAPID_PUBLIC_KEY && !bindings.VAPID_PRIVATE_KEY) {
	const keys = await generateVapidKeys();
	bindings.VAPID_PUBLIC_KEY = keys.publicKey;
	bindings.VAPID_PRIVATE_KEY = keys.privateKey;
}
const settings = config(bindings);
// Before `serveDev`, whose `Bun.serve` the SDK wraps to continue the browser's traces as `http.server` transactions.
if (settings.sentry) {
	Sentry.init({
		...serverOptions(settings.sentry),
		integrations: [Sentry.bunServerIntegration({ maxRequestBodySize: 'always' })],
	});
}
const root = join(import.meta.dir, '../..');
const file = process.env.PROCRASTIMATE_DATABASE ?? join(root, '.data', `${basename(root)}.sqlite`);
if (file !== ':memory:') mkdirSync(join(file, '..'), { recursive: true });
const store = bunStore(file);
// A backup or an import, loaded into a database that holds no user yet; `restoreDump` refuses any other.
const restore = process.env.PROCRASTIMATE_RESTORE;
if (restore) {
	const counts = restoreDump(store.db, JSON.parse(await Bun.file(restore).text()), Date.now());
	console.log('Restored', restore, JSON.stringify(counts));
}
const server = await serveDev(API_PORT, bindings, store);

console.log('Server running at:', server.url.href);
console.log('Database:', file, `(head ${store.space.head()})`);
console.log(
	'Ramble transcribes with:',
	settings.ramble?.kind === 'cassette'
		? 'cassettes'
		: [settings.ramble && 'ElevenLabs', settings.gemini && 'Gemini Live'].filter(Boolean).join(', ') || 'nothing (off)',
);
console.log('Sentry:', settings.sentry ? `${settings.sentry.environment} ${settings.sentry.release}` : 'off');
