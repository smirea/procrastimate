import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { onError } from '@orpc/server';
import { SENTRY_TUNNEL_PATH } from '../../shared/sentry';
import { clientOf, forgetSession, readActor } from './actor';
import type { App } from './app';
import { errorResponse } from './errors';
import { imagesRoute, isImageRoute } from './images';
import { faviconRoute, isFaviconRoute } from './link-preview';
import { router } from './router';
import { reportError, reportRpcError, sentryTunnel } from './sentry';
import { handleSync, withBearer } from 'sync-engine/core';
import { syncContext } from './writes';

const rpc = new OpenAPIHandler(router, { interceptors: [onError(reportRpcError)] });

/**
 * `POST /api/sync`, sync-engine's one round trip, for signed-in humans: an AI account writes through the agent API.
 * The hooks in `writes.ts` decide each write as this actor, and a refusal is reported as a warning.
 */
async function syncRoute(request: Request, app: App): Promise<Response> {
	const actor = await readActor(request, app);
	if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
	if (actor.kind !== 'human') return errorResponse('FORBIDDEN', 'AI accounts write through the agent API');
	const client = clientOf(request);
	if (!client) return errorResponse('BAD_REQUEST', 'Invalid client header');
	// The engine keeps each client's last sequence by client id; scoping it to the user keeps anyone who learned another
	// device's id from acknowledging that device's writes away.
	let body = await request.text();
	let clientId: string | null = null;
	try {
		const parsed = JSON.parse(body) as { client?: unknown };
		if (typeof parsed.client === 'string') {
			clientId = `${actor.id}:${parsed.client}`;
			body = JSON.stringify({ ...parsed, client: clientId });
		}
	} catch {
		// handleSync answers 400 for a body that is not JSON.
	}
	const response = await handleSync(
		app.store.space,
		new Request(request.url, { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
		syncContext(actor, client, { clientId }),
	);
	if (response.ok) {
		const { rejected } = (await response.clone().json()) as { rejected: unknown[] };
		if (rejected.length) reportError(new Error('sync: rejected writes'), 'warning', { rejected });
	}
	return response;
}

/** `GET /api/live`. A browser cannot set headers on a WebSocket, so its token is the `bearer.<token>` subprotocol. */
async function liveRoute(request: Request, app: App): Promise<Response> {
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return errorResponse('UPGRADE_REQUIRED', 'Expected a WebSocket', 426);
	}
	const actor = await readActor(withBearer(request), app);
	if (!actor || actor.kind !== 'human') return errorResponse('UNAUTHORIZED', 'Not signed in');
	return app.live.accept(request);
}

/**
 * One fetch handler for `/api/*` but Ramble's socket. `dev-server.ts` serves it with Bun and the `App` Durable Object
 * on Cloudflare, so it stays free of Bun and Node APIs. A request that moved the space's head, whether a sync, a
 * command, or a share that changed `access` rows, tells every sync socket once it is answered.
 */
export async function handle(request: Request, app: App): Promise<Response> {
	const before = app.store.space.head();
	const response = await route(request, app);
	const head = app.store.space.head();
	if (head > before) app.live.publish(head);
	return response;
}

/** The Sentry tunnel, sync and its live socket, image bytes, link icons, the contract's procedures, then Better Auth. */
async function route(request: Request, app: App): Promise<Response> {
	const url = new URL(request.url);
	if (request.method === 'POST' && url.pathname === SENTRY_TUNNEL_PATH) return sentryTunnel(request, app.config);
	if (request.method === 'POST' && url.pathname === '/api/sync') return syncRoute(request, app);
	if (url.pathname === '/api/live') return liveRoute(request, app);
	if (isImageRoute(request)) return imagesRoute(request, app);
	if (isFaviconRoute(request)) return faviconRoute(request, app);
	const { matched, response } = await rpc.handle(request, { context: { app, request } });
	if (matched) return response;
	if (url.pathname === '/api/auth/sign-out') forgetSession(request);
	if (url.pathname.startsWith('/api/auth/')) return app.auth.handler(request);
	return errorResponse('NOT_FOUND', 'Not found');
}
