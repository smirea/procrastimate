import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { onError } from '@orpc/server';
import { RAMBLE_SOCKET_PATH } from '../../shared/ramble/protocol';
import { SENTRY_TUNNEL_PATH } from '../../shared/sentry';
import { forgetSession, readActor } from './actor';
import type { App } from './app';
import { errorResponse } from './errors';
import { imagesRoute, isImageRoute } from './images';
import { router } from './router';
import { identify, reportRpcError, sentryTunnel } from './sentry';
import { handleSync, withBearer } from 'sync-engine/core';
import { clientOf } from './actor';
import { syncContext } from './writes';
import { reportError } from './sentry';

const rpc = new OpenAPIHandler(router, { interceptors: [onError(reportRpcError)] });

async function rambleRoute(request: Request, app: App): Promise<Response> {
	const actor = await readActor(request, app);
	if (!actor || actor.kind !== 'human') return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
	identify(actor);
	if (!app.ramble) return Response.json({ ok: false, error: 'Ramble is not configured' }, { status: 503 });
	return app.ramble(request, actor);
}

/**
 * `POST /api/sync`, sync-engine's one round trip, for signed-in humans: an AI account writes through the agent API.
 * The hooks in `writes.ts` decide each write as this actor, and a refusal is reported as a warning.
 */
async function syncRoute(request: Request, app: App): Promise<Response> {
	const actor = await readActor(request, app);
	if (!actor) return Response.json({ error: 'Not signed in' }, { status: 401 });
	if (actor.kind !== 'human')
		return Response.json({ error: 'AI accounts write through the agent API' }, { status: 403 });
	const client = clientOf(request);
	if (!client) return Response.json({ error: 'Invalid client header' }, { status: 400 });
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
	const space = app.store.space;
	const before = space.head();
	const response = await handleSync(
		space,
		new Request(request.url, { method: 'POST', body, headers: { 'content-type': 'application/json' } }),
		syncContext(actor, client, { clientId }),
	);
	const head = space.head();
	if (head > before) app.live.publish(head);
	if (response.ok) {
		const { rejected } = (await response.clone().json()) as { rejected: unknown[] };
		if (rejected.length) reportError(new Error('sync: rejected writes'), 'warning', { rejected });
	}
	return response;
}

/** `GET /api/live`. A browser cannot set headers on a WebSocket, so its token is the `bearer.<token>` subprotocol. */
async function liveRoute(request: Request, app: App): Promise<Response> {
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return Response.json({ error: 'Expected a WebSocket' }, { status: 426 });
	}
	const actor = await readActor(withBearer(request), app);
	if (!actor || actor.kind !== 'human') return Response.json({ error: 'Not signed in' }, { status: 401 });
	return app.live.accept(request);
}

/**
 * One fetch handler for `/api/*`: the Sentry tunnel, sync and its live socket, image bytes, Ramble's socket, the
 * contract's procedures, then Better Auth for the rest of `/api/auth/*`. `index.ts` serves it with Bun and the `App`
 * Durable Object on Cloudflare, so it stays free of Bun and Node APIs.
 */
export async function handle(request: Request, app: App): Promise<Response> {
	const url = new URL(request.url);
	if (request.method === 'POST' && url.pathname === SENTRY_TUNNEL_PATH) return sentryTunnel(request, app.env);
	if (request.method === 'POST' && url.pathname === '/api/sync') return syncRoute(request, app);
	if (url.pathname === '/api/live') return liveRoute(request, app);
	if (isImageRoute(request)) return imagesRoute(request, app);
	if (url.pathname === RAMBLE_SOCKET_PATH) return rambleRoute(request, app);
	const { matched, response } = await rpc.handle(request, { context: { app, request } });
	if (matched) return response;
	if (url.pathname === '/api/auth/sign-out') forgetSession(request);
	if (url.pathname.startsWith('/api/auth/')) return app.auth.handler(request);
	return errorResponse('NOT_FOUND', 'Not found');
}
