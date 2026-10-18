import type { DurableObjectNamespace, Hyperdrive, R2Bucket } from '@cloudflare/workers-types';

/**
 * Raw Worker bindings. Every field is optional here because Bun serves the same handler without the Cloudflare ones.
 * Read them through `config(env)` in `config.ts`, which decides what is required.
 */
export type Env = {
	/** Postgres on the Worker. The Bun dev server, scripts, and tests set `DATABASE_URL` instead. */
	HYPERDRIVE?: Hyperdrive;
	DATABASE_URL?: string;
	RAMBLE?: DurableObjectNamespace;
	BACKUPS?: R2Bucket;
	/** Where `/api/powersync/*` is forwarded. A plain var, not a secret. */
	POWERSYNC_URL?: string;
	/** The Ed25519 private JWK, with its `kid`, that signs PowerSync tokens. A Worker secret. */
	POWERSYNC_JWT_PRIVATE_KEY?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	BETTER_AUTH_SECRET?: string;
	/** `off` disables Better Auth's sign-in rate limit, for tests that sign up many users from one address. */
	AUTH_RATE_LIMIT?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_IOS_CLIENT_ID?: string;
	APPLE_CLIENT_ID?: string;
	APPLE_CLIENT_SECRET?: string;
	APPLE_TEAM_ID?: string;
	APPLE_KEY_ID?: string;
	/** A PKCS8 .p8, with newlines as `\n` when the secret is a single line. */
	APPLE_PRIVATE_KEY?: string;
	ELEVENLABS_API_KEY?: string;
	/** `cassette` replays recorded transcripts instead of calling ElevenLabs, for `wrangler dev` in tests. */
	RAMBLE_UPSTREAM?: string;
	/** Plain vars `wrangler deploy --var` sets, never secrets. See `Config.sentry`. */
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
};

export type Handler = (request: Request, env: Env) => Response | Promise<Response>;
