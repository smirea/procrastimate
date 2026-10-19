import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';
import { DEVICE_HEADER } from 'shared/auth.ts';
import type { PushMessage } from 'shared/push.ts';
import { cachedInstallId } from '../lib/install-cache.ts';
import databaseWorker from 'virtual:database-worker';

/**
 * The app shell, so a cold launch offline opens the local tasks: the one HTML (`/`, since the host redirects
 * `/index.html`), the built scripts, the database worker with the SQLite wasm it runs, and the static files. A new
 * deploy takes over at once (`skipWaiting` and `claim`) and drops the old shells.
 */
const SHELL = `shell-${version}`;
/**
 * PowerSync's default IndexedDB VFS without encryption loads only `wa-sqlite-async`, and only in its worker; the build
 * also emits the sync and encrypted variants and a copy for the page, about 12 MB never used. A worker file cached on
 * first use instead was lost with the old shell at every deploy, so the first launch offline after one could not open
 * the database.
 */
const DATABASE_WASM = /\/wa-sqlite-async-[\w-]+\.wasm$/;
/** Past this a navigation answers from the shell, so a connection that is up but barely moving still opens at once. */
const NAVIGATION_DEADLINE_MS = 1500;
// The manifest's paths have no leading slash. `_headers` and `.well-known` are the host's, not served as files.
const PRECACHED = new Set([
	'/',
	...immutable.map(file => `/${file.path}`).filter(path => !path.endsWith('.wasm')),
	...databaseWorker.filter(path => !path.endsWith('.wasm') || DATABASE_WASM.test(path)),
	...assets.map(file => `/${file.path}`).filter(path => !path.startsWith('/.well-known/') && path !== '/_headers'),
]);

/**
 * The host sends the shell compressed, with `Vary: Accept-Encoding`, and the Cache API keeps those headers on a body
 * it has already decoded. A script load's request carries `Accept-Encoding` where a page's `fetch` does not, so the
 * `Vary` check misses the entry and Chromium cannot load a module from the cache: stored without the encoding
 * headers, and matched ignoring `Vary`.
 */
async function decoded(response: Response): Promise<Response> {
	const headers = new Headers(response.headers);
	headers.delete('content-encoding');
	headers.delete('content-length');
	headers.delete('vary');
	return new Response(await response.arrayBuffer(), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

async function precache(): Promise<void> {
	const cache = await caches.open(SHELL);
	await Promise.all(
		[...PRECACHED].map(async path => {
			const response = await fetch(path);
			if (!response.ok) throw new Error(`${path} answered ${response.status}`);
			await cache.put(path, await decoded(response));
		}),
	);
}

self.addEventListener('install', event => {
	event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches
			.keys()
			.then(keys =>
				Promise.all(keys.filter(key => key.startsWith('shell-') && key !== SHELL).map(key => caches.delete(key))),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', event => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
	if (request.mode === 'navigate') {
		event.respondWith(navigate(request));
		return;
	}
	const immutable = url.pathname.startsWith('/_app/immutable/');
	if (!immutable && !PRECACHED.has(url.pathname)) return;
	event.respondWith(
		caches.match(request, { ignoreVary: true }).then(
			cached =>
				cached ??
				fetch(request).then(async response => {
					if (immutable && response.ok) await (await caches.open(SHELL)).put(request, await decoded(response.clone()));
					return response;
				}),
		),
	);
});

/** The network's page while it answers in time, else the cached shell, else whatever the network ends up answering. */
async function navigate(request: Request): Promise<Response> {
	const network = fetch(request);
	const deadline = new Promise<'late'>(resolve => setTimeout(() => resolve('late'), NAVIGATION_DEADLINE_MS));
	const first = await Promise.race([network.catch(() => 'failed' as const), deadline]);
	if (first instanceof Response) return first;
	const shell = await caches.match('/', { ignoreVary: true });
	if (shell) return shell;
	return first === 'failed' ? Response.error() : network.catch(() => Response.error());
}

/** The browser rotated the subscription while the app was closed, so the server learns the new one here. */
self.addEventListener('pushsubscriptionchange', event => {
	const change = event as Event & {
		oldSubscription: PushSubscription | null;
		newSubscription: PushSubscription | null;
	};
	event.waitUntil(
		(async () => {
			const subscription =
				change.newSubscription ??
				(await self.registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: change.oldSubscription?.options.applicationServerKey ?? undefined,
				}));
			const installId = await cachedInstallId();
			if (!installId) return;
			await fetch('/api/push/subscription', {
				method: 'PUT',
				credentials: 'include',
				headers: { 'content-type': 'application/json', [DEVICE_HEADER]: installId },
				body: JSON.stringify({ subscription: subscription.toJSON() }),
			});
		})(),
	);
});

// iOS revokes the subscription of a site whose push shows nothing, so every push shows a notification.
self.addEventListener('push', event => {
	const message = parse(event.data?.text());
	event.waitUntil(
		self.registration.showNotification(message.title, {
			body: message.body,
			tag: message.tag,
			icon: '/icons/icon-192.png',
			badge: '/icons/badge-96.png',
			data: { taskId: message.taskId },
		}),
	);
});

self.addEventListener('notificationclick', event => {
	event.notification.close();
	const taskId: string | null = event.notification.data?.taskId ?? null;
	event.waitUntil(open(taskId));
});

async function open(taskId: string | null) {
	const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	if (client) {
		await client.focus();
		client.postMessage({ type: 'open-task', taskId });
		return;
	}
	await self.clients.openWindow(taskId ? `/inbox?task=${encodeURIComponent(taskId)}` : '/inbox');
}

function parse(text: string | undefined): PushMessage {
	try {
		const message = JSON.parse(text ?? '');
		if (typeof message?.title === 'string') {
			return {
				title: message.title,
				body: typeof message.body === 'string' ? message.body : '',
				tag: typeof message.tag === 'string' ? message.tag : '',
				taskId: typeof message.taskId === 'string' ? message.taskId : null,
			};
		}
	} catch {}
	return { title: 'ProcrastiMate', body: 'A task is due', tag: '', taskId: null };
}
