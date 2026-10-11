import { accountApiRoutes } from './account/account';
import { authHandler, deleteAccount, methodsResponse } from './better-auth';
import type { Env, Handler } from './bindings';
import { pushRoutes } from './push';

export { Account } from './account/account';

const routes: Record<string, Handler> = {
	'GET /api/status': () => Response.json({ ok: true }),
	...pushRoutes,
	...accountApiRoutes,
};

const notFound = () => Response.json({ ok: false, error: 'Not found' }, { status: 404 });

export default {
	fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === 'GET' && url.pathname === '/api/auth/methods') return methodsResponse(env);
		if (request.method === 'POST' && url.pathname === '/api/account/delete') return deleteAccount(request, env);
		if (url.pathname.startsWith('/api/auth/')) return authHandler(request, env);
		const route = routes[`${request.method} ${url.pathname}`];
		return route ? route(request, env) : notFound();
	},
} satisfies { fetch: (request: Request, env: Env) => Response | Promise<Response> };
