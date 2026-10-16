import type { DurableObjectNamespace } from '@cloudflare/workers-types';

/**
 * Raw Worker bindings. Every field is optional here because Bun serves the same handler without the Cloudflare ones.
 * Read them through `config(env)` in `config.ts`, which decides what is required.
 */
export type Env = {
	ACCOUNT?: DurableObjectNamespace;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	/** Task storage. Both are Worker secrets. `TURSO_API_TOKEN` is not a Worker binding. */
	TURSO_DATABASE_URL?: string;
	TURSO_AUTH_TOKEN?: string;
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
	/** See `Config.ephemeral`. */
	EPHEMERAL?: string;
};

export type Handler = (request: Request, env: Env) => Response | Promise<Response>;
