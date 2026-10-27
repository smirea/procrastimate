import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { instrumentDurableObjectWithSentry, withSentry } from '@sentry/cloudflare';
import type { Actor } from '../../shared/auth';
import { RAMBLE_SOCKET_PATH } from '../../shared/ramble/protocol';
import { AppObject, INTERNAL } from './app-object';
import { appFetch, appStub } from './app-stub';
import type { Env } from './bindings';
import { config } from './config';
import { Ramble as RambleObject, RAMBLE_ACTOR_HEADER } from './ramble-object';
import { sentryOptions } from './sentry';

/**
 * The Cloudflare entry `wrangler.jsonc` names. Static assets never reach it. `/api/*` goes to the one `App` object,
 * except Ramble's socket, which the Worker authenticates through `App` and hands to the user's `Ramble` object, so
 * an hour of audio frames never runs on the object every request waits on.
 */

export const App = instrumentDurableObjectWithSentry(sentryOptions, AppObject);
export const Ramble = instrumentDurableObjectWithSentry(sentryOptions, RambleObject as never);

async function ramble(request: Request, env: Env): Promise<Response> {
	if (!env.RAMBLE) return Response.json({ ok: false, error: 'Ramble is not configured' }, { status: 503 });
	const answer = await appFetch(env, INTERNAL.actor, {}, { headers: request.headers });
	const actor = (await answer.json()) as Actor | null;
	if (!actor || actor.kind !== 'human') return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
	const headers = new Headers(request.headers);
	headers.set(RAMBLE_ACTOR_HEADER, JSON.stringify(actor));
	const stub = env.RAMBLE.get(env.RAMBLE.idFromName(actor.id));
	return stub.fetch(new Request(request, { headers }) as never) as unknown as Promise<Response>;
}

async function fetch(request: Request, env: Env): Promise<Response> {
	// Before routing, so a misconfigured deploy fails every request with the missing key named.
	config(env);
	if (new URL(request.url).pathname === RAMBLE_SOCKET_PATH) return ramble(request, env);
	return appStub(env).fetch(request as never) as unknown as Promise<Response>;
}

/** A throw marks the cron check-in failed. */
async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
	config(env);
	const response = await appFetch(env, INTERNAL.cron, { cron: controller.cron, at: controller.scheduledTime });
	if (!response.ok) throw new Error(`cron ${controller.cron} failed: ${response.status} ${await response.text()}`);
	const said = (await response.json()) as string;
	if (said) console.log(said);
	void ctx;
}

// A copy, because `withSentry` patches the handler object it is given.
export default withSentry(sentryOptions, { fetch, scheduled } as never);
