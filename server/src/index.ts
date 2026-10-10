import api from './api';
import env from './env';

const server = Bun.serve({
	development: true,
	idleTimeout: 120,
	port: env.API_PORT,
	fetch: api.fetch,
});

console.log('Server running at:', server.url);
