/**
 * The install id, kept where both the page and the service worker can read it: `localStorage` is the page's alone,
 * and the worker needs the id to register a subscription the browser rotated while the app was closed.
 */
const CACHE = 'procrastimate-device';
const KEY = '/install-id';

export async function rememberInstallId(id: string): Promise<void> {
	if (!('caches' in globalThis)) return;
	await (await caches.open(CACHE)).put(KEY, new Response(id));
}

export async function cachedInstallId(): Promise<string | null> {
	if (!('caches' in globalThis)) return null;
	const cached = await (await caches.open(CACHE)).match(KEY);
	return cached ? cached.text() : null;
}

export async function forgetInstallId(): Promise<void> {
	if (!('caches' in globalThis)) return;
	await (await caches.open(CACHE)).delete(KEY);
}
