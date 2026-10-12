import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { accountApiRoutes } from './account/account';
import { authHandler } from './better-auth';
import type { Env } from './bindings';
import { errorResponse } from './errors';
import { workerRouter } from './router';

export { Account } from './account/account';

const rpc = new OpenAPIHandler(workerRouter);

/**
 * The Worker's procedures first, then the user's `Account` object, whose bodies it forwards unread, then Better
 * Auth for the rest of `/api/auth/*`.
 */
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const forward = accountApiRoutes[`${request.method} ${url.pathname}`];
		if (forward) return forward(request, env);
		const { matched, response } = await rpc.handle(request, { context: { env, request } });
		if (matched) return response;
		if (url.pathname.startsWith('/api/auth/')) return authHandler(request, env);
		return errorResponse('NOT_FOUND', 'Not found');
	},
} satisfies { fetch: (request: Request, env: Env) => Response | Promise<Response> };
