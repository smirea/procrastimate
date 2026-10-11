import type { DurableObjectNamespace } from '@cloudflare/workers-types';

/**
 * Worker bindings. Every field is optional because Bun serves the same handler in development with none of the
 * Cloudflare ones, and a deploy without a secret must still work with that feature off.
 */
export type Env = {
	ACCOUNT?: DurableObjectNamespace;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	SYNC_SETUP_CODE?: string;
	/** Task storage. Both are Worker secrets. `TURSO_API_TOKEN` is not a Worker binding. */
	TURSO_DATABASE_URL?: string;
	TURSO_AUTH_TOKEN?: string;
	/** Better Auth. Unset means sign-in is off, except when `E2E_SHARD` supplies the suite secret. */
	BETTER_AUTH_SECRET?: string;
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
	/**
	 * Set only by the end-to-end run. Each test signs in as its own user, and Turso is left untouched.
	 * Production never sets it.
	 */
	E2E_SHARD?: string;
};

export type Handler = (request: Request, env: Env) => Response | Promise<Response>;
