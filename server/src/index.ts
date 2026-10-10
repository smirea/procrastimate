import { memoryAccount } from './account/account';
import api from './api';
import env from './env';

const bindings = { ACCOUNT: memoryAccount(env.SYNC_SETUP_CODE) };

const server = Bun.serve({
	development: true,
	idleTimeout: 120,
	port: env.API_PORT,
	fetch: request => api.fetch(request, bindings),
});

console.log('Server running at:', server.url);
