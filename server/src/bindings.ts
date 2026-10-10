import type { DurableObjectNamespace } from '@cloudflare/workers-types';

/**
 * Worker bindings. Every field is optional because Bun serves the same handler in development with none of the
 * Cloudflare ones, and a deploy without a secret must still work with that feature off.
 */
export type Env = {
	PUSH?: DurableObjectNamespace;
	ACCOUNT?: DurableObjectNamespace;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	SYNC_SETUP_CODE?: string;
};

export type Handler = (request: Request, env: Env) => Response | Promise<Response>;
