import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { Env } from './bindings';

/** Every request reaches the same object, so every user's rows live in one database. */
const APP_NAME = 'main';

export function appStub(env: Env) {
	const namespace = env.APP as DurableObjectNamespace | undefined;
	if (!namespace) throw new Error('The APP Durable Object binding is missing');
	return namespace.get(namespace.idFromName(APP_NAME));
}

const internal = (path: string, params: Record<string, string | number> = {}) => {
	const url = new URL(`https://app${path}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	return url.toString();
};

export const appFetch = (env: Env, path: string, params?: Record<string, string | number>, init?: RequestInit) =>
	appStub(env).fetch(internal(path, params), init as never) as unknown as Promise<Response>;
