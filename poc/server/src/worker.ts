import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createApp } from './app';

type Env = { HYPERDRIVE: { connectionString: string }; POWERSYNC_URL: string; BASE_URL: string };

export default {
	async fetch(request: Request, env: Env) {
		const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
		const handle = createApp({
			db: drizzle(sql),
			powersyncUrl: env.POWERSYNC_URL,
			baseURL: env.BASE_URL,
			secret: 'poc-secret-poc-secret-poc-secret-poc',
		});
		return handle(request);
	},
};
