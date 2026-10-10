const routes: Record<string, (request: Request) => Response | Promise<Response>> = {
	'/api/status': () => Response.json({ ok: true }),
};

export default {
	fetch(request: Request): Response | Promise<Response> {
		const route = routes[new URL(request.url).pathname];
		return route ? route(request) : Response.json({ ok: false, error: 'Not found' }, { status: 404 });
	},
};
