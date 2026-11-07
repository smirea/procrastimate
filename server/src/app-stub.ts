import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import type { Env } from './config';

/** Every request reaches the same object, so every user's rows live in one database. */
const APP_NAME = 'main';

/** What the Worker and the `Ramble` object ask the `App` object for, on paths the internet never reaches. */
export const INTERNAL = {
	actor: '/internal/actor',
	cron: '/internal/cron',
	rambleZone: '/internal/ramble/zone',
	rambleKeyterms: '/internal/ramble/keyterms',
	rambleStored: '/internal/ramble/stored',
	rambleAdd: '/internal/ramble/add',
} as const;
type Internal = keyof typeof INTERNAL;

export function appStub(env: Env) {
	const namespace = env.APP as DurableObjectNamespace | undefined;
	if (!namespace) throw new Error('The APP Durable Object binding is missing');
	return namespace.get(namespace.idFromName(APP_NAME));
}

export function appFetch(env: Env, call: Internal, params: Record<string, string | number> = {}, init?: RequestInit) {
	const url = new URL(`https://app${INTERNAL[call]}`);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	return appStub(env).fetch(url.toString(), init as never) as unknown as Promise<Response>;
}
