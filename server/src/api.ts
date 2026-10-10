import { pushRoutes, type Env, type Handler } from './push';

export { PushSchedule } from './push';

const routes: Record<string, Handler> = {
	'GET /api/status': () => Response.json({ ok: true }),
	...pushRoutes,
};

export default {
	fetch(request, env) {
		const route = routes[`${request.method} ${new URL(request.url).pathname}`];
		return route ? route(request, env) : Response.json({ ok: false, error: 'Not found' }, { status: 404 });
	},
} satisfies { fetch: (request: Request, env: Env) => Response | Promise<Response> };
