type Handler = (request: Request) => Response | Promise<Response>;

const routes: Record<string, Handler> = {
	'/api/status': () => Response.json({ ok: true }),
};

export default {
	fetch(request) {
		const route = routes[new URL(request.url).pathname];
		return route ? route(request) : Response.json({ ok: false, error: 'Not found' }, { status: 404 });
	},
} satisfies { fetch: Handler };
