import { createAuth, type Auth } from './better-auth';
import type { Config } from './config';
import type { Store } from './db/store';
import type { Db } from './db/sqlite';
import type { Live } from './live';
import { reportError } from './sentry';

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
	/** Runs `work` after the response, such as naming a feedback task, and tells the sync sockets what it wrote. It never rejects. */
	defer: (work: () => Promise<void>) => void;
};

export async function createApp(
	settings: Config,
	store: Store,
	live: Live,
	keepAlive: (work: Promise<void>) => void = () => {},
): Promise<App> {
	// `handle` publishes only what a request wrote before it answered, so deferred writes publish their own head.
	const defer = (work: () => Promise<void>) => {
		const before = store.space.head();
		const run = work().then(() => {
			const head = store.space.head();
			if (head > before) live.publish(head);
		});
		keepAlive(run.catch(error => void reportError(error)));
	};
	return { config: settings, db: store.db, store, auth: await createAuth(settings, store), live, defer };
}

/** Behind Vite's dev proxy only the browser's `Origin` names the app's port; a bot's request has none. */
export const originOf = (request: Request) => request.headers.get('origin') ?? new URL(request.url).origin;
