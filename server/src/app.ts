import { createAuth, type Auth } from './better-auth';
import type { Env } from './bindings';
import { config, type Config } from './config';
import type { Store } from './db/store';
import type { Db } from './db/sqlite';
import type { Live } from './live';
import type { RambleRoute } from './ramble';

/**
 * Everything a request handler needs, built once per process by the Bun dev server and once per object by the `App`
 * Durable Object. Routes read `app`, never the raw bindings. `ramble` answers the transcription socket's upgrade in
 * development; on the Worker the Worker itself forwards it to the `Ramble` object. `live` holds the sync sockets.
 */
export type App = {
	env: Env;
	config: Config;
	db: Db;
	store: Store;
	auth: Auth;
	ramble: RambleRoute | null;
	live: Live;
};

export async function createApp(env: Env, store: Store, ramble: RambleRoute | null, live: Live): Promise<App> {
	const settings = config(env);
	return { env, config: settings, db: store.db, store, auth: await createAuth(settings, store), ramble, live };
}

/** Behind Vite's dev proxy only the browser's `Origin` names the app's port; a bot's request has none. */
export const originOf = (request: Request) => request.headers.get('origin') ?? new URL(request.url).origin;
