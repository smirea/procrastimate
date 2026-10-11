import { serveDev } from './dev-server';
import env from './env';

const server = serveDev({ port: env.API_PORT, setupCode: env.SYNC_SETUP_CODE });

console.log('Server running at:', server.url);
