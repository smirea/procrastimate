import { createAuth, type Auth } from './better-auth';
import type { Config } from './config';
import type { Store } from './db/store';
import type { Db } from './db/sqlite';
import type { Live } from './live';

/**
 * Everything a request handler needs, built once per process by the Bun dev server and once per object by the `App`
 * Durable Object. Routes read `app`, never the raw bindings. `live` holds the sync sockets.
 */
export type App = {
	config: Config;
	db: Db;
	store: Store;
	auth: Auth;
	live: Live;
};

export async function createApp(settings: Config, store: Store, live: Live): Promise<App> {
	return { config: settings, db: store.db, store, auth: await createAuth(settings, store), live };
}

/** Behind Vite's dev proxy only the browser's `Origin` names the app's port; a bot's request has none. */
export const originOf = (request: Request) => request.headers.get('origin') ?? new URL(request.url).origin;
