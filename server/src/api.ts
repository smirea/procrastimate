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
import { POWERSYNC_PATH, powersyncProxy } from './sync';

const rpc = new OpenAPIHandler(router, { interceptors: [onError(reportRpcError)] });

async function rambleRoute(request: Request, app: App): Promise<Response> {
	const actor = await readActor(request, app);
	if (!actor || actor.kind !== 'human') return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
	identify(actor);
	return app.ramble(request, actor);
}

/**
 * One fetch handler for `/api/*`: the Sentry tunnel, the PowerSync proxy, image bytes, Ramble's socket, the
 * contract's procedures, then Better Auth for the rest of `/api/auth/*`. `index.ts` serves it with Bun and
 * `worker.ts` on Cloudflare with Sentry around it, so it stays free of Bun and Node APIs.
 */
export async function handle(request: Request, app: App): Promise<Response> {
	const url = new URL(request.url);
	if (request.method === 'POST' && url.pathname === SENTRY_TUNNEL_PATH) return sentryTunnel(request, app.env);
	if (url.pathname.startsWith(`${POWERSYNC_PATH}/`)) return powersyncProxy(request, app.config.powersync.url);
	if (isImageRoute(request)) return imagesRoute(request, app);
	if (url.pathname === RAMBLE_SOCKET_PATH) return rambleRoute(request, app);
	const { matched, response } = await rpc.handle(request, { context: { app, request } });
	if (matched) return response;
	if (url.pathname === '/api/auth/sign-out') forgetSession(request);
	if (url.pathname.startsWith('/api/auth/')) return app.auth.handler(request);
	return errorResponse('NOT_FOUND', 'Not found');
}
