import * as Sentry from '@sentry/bun';
import { sentryRelease } from '../../scripts/sentry-release.mts';
import devJwtKey from '../../powersync/local/INSECURE-dev-jwt-key.json' with { type: 'json' };
import type { Env } from './bindings';
import { config } from './config';
import { migrate } from './db/migrate';
import { connect } from './db/postgres';
import { serveDev } from './dev-server';
import env from './env';
import { serverOptions } from './sentry';
import { generateVapidKeys } from './web-push';

/**
 * The Bun entry. Values env-manager leaves empty get local stand-ins: the committed dev signing key the local
 * PowerSync trusts, a fixed auth secret, no sign-in rate limit, and a fresh VAPID pair per start. The database and
 * PowerSync URLs have no stand-in, because `scripts/setup-worktree.ts` writes them.
 */

const INSECURE_DEV_AUTH_SECRET = 'insecure-local-dev-better-auth-secret-0123456789';

const { API_PORT, ...secrets } = env;
const bindings: Env = {
	...secrets,
	BETTER_AUTH_SECRET: secrets.BETTER_AUTH_SECRET ?? INSECURE_DEV_AUTH_SECRET,
	// Local sign-ups come in bursts from one address: every smoke run, every e2e worker, every agent's test user.
	AUTH_RATE_LIMIT: secrets.AUTH_RATE_LIMIT ?? 'off',
	POWERSYNC_JWT_PRIVATE_KEY: secrets.POWERSYNC_JWT_PRIVATE_KEY ?? JSON.stringify(devJwtKey),
	SENTRY_RELEASE: sentryRelease(secrets.SENTRY_ENVIRONMENT, secrets.SENTRY_RELEASE),
};
if (!bindings.DATABASE_URL || !bindings.POWERSYNC_URL) {
	throw new Error('DATABASE_URL and POWERSYNC_URL are unset. Run `bun scripts/setup-worktree.ts` first.');
}
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
const { db } = connect(settings.database);
// Before listening, so a database with a foreign history stops the server instead of failing each request.
const applied = await migrate(db);
const server = await serveDev(API_PORT, bindings, db);

console.log('Server running at:', server.url.href);
console.log(
	'Database:',
	settings.database.replace(/\/\/[^@]*@/, '//'),
	applied.length ? `(migrated ${applied.join(', ')})` : '',
);
console.log('PowerSync:', settings.powersync.url);
console.log(
	'Ramble transcribes with:',
	settings.ramble?.kind === 'cassette'
		? 'cassettes'
		: [settings.ramble && 'ElevenLabs', settings.gemini && 'Gemini Live'].filter(Boolean).join(', ') || 'nothing (off)',
);
console.log('Sentry:', settings.sentry ? `${settings.sentry.environment} ${settings.sentry.release}` : 'off');
