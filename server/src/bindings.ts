import type { DurableObjectNamespace, R2Bucket } from '@cloudflare/workers-types';

/**
 * Raw Worker bindings. Every field is optional here because Bun serves the same handler without the Cloudflare ones.
 * Read them through `config(env)` in `config.ts`, which decides what is required.
 */
export type Env = {
	/** The `App` Durable Object, which holds the database and serves `/api/*` on the Worker. */
	APP?: DurableObjectNamespace;
	RAMBLE?: DurableObjectNamespace;
	BACKUPS?: R2Bucket;
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
	/** Ramble's smart parse, a Worker secret. */
	GEMINI_API_KEY?: string;
	/** `cassette` replays recorded transcripts instead of calling ElevenLabs, for `wrangler dev` in tests. */
	RAMBLE_UPSTREAM?: string;
	/** Plain vars `wrangler deploy --var` sets, never secrets. See `Config.sentry`. */
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
};

export type Handler = (request: Request, env: Env) => Response | Promise<Response>;
