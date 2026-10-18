import { createAuth, type Auth } from './better-auth';
import type { Env } from './bindings';
import { config, type Config } from './config';
import type { Db } from './db/postgres';
import type { RambleRoute } from './ramble';

/**
 * Everything a request handler needs, built once per process by the Bun dev server and once per request on the
 * Worker, whose database client lives only as long as the request. Routes read `app`, never the raw bindings.
 * `ramble` answers the transcription socket's upgrade: the Durable Object on the Worker, Bun's own sockets in
 * development.
 */
export type App = { env: Env; config: Config; db: Db; auth: Auth; ramble: RambleRoute };

export async function createApp(env: Env, db: Db, ramble: RambleRoute): Promise<App> {
	const settings = config(env);
	return { env, config: settings, db, auth: await createAuth(settings, db), ramble };
}

/** Behind Vite's dev proxy only the browser's `Origin` names the app's port; a bot's request has none. */
export const originOf = (request: Request) => request.headers.get('origin') ?? new URL(request.url).origin;
