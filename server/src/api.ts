import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { onError } from '@orpc/server';
import { accountApiRoutes } from './account/account';
import { authHandler } from './better-auth';
import type { Env } from './bindings';
import { config } from './config';
import { errorResponse } from './errors';
import { workerRouter } from './router';
import { SENTRY_TUNNEL_PATH } from '../../shared/sentry';
import { reportRpcError, sentryTunnel } from './sentry';

const rpc = new OpenAPIHandler(workerRouter, { interceptors: [onError(reportRpcError)] });

/**
 * The Worker's procedures first, then the user's `Account` object, whose bodies it forwards unread, then Better
 * Auth for the rest of `/api/auth/*`. `worker.ts` serves it on Cloudflare with Sentry around it.
 */
export default {
	async fetch(request, env) {
		// Before routing, so a misconfigured deploy fails every request with the missing key named, not only the
		// requests that reach the feature.
		config(env);
		const url = new URL(request.url);
		if (request.method === 'POST' && url.pathname === SENTRY_TUNNEL_PATH) return sentryTunnel(request, env);
		const forward = accountApiRoutes[`${request.method} ${url.pathname}`];
		if (forward) return forward(request, env);
		const { matched, response } = await rpc.handle(request, { context: { env, request } });
		if (matched) return response;
		if (url.pathname.startsWith('/api/auth/')) return authHandler(request, env);
		return errorResponse('NOT_FOUND', 'Not found');
	},
} satisfies { fetch: (request: Request, env: Env) => Response | Promise<Response> };
