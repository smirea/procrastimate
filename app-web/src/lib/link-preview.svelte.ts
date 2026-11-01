import { FAVICON_PATH } from 'shared/links.ts';
import { SvelteSet } from 'svelte/reactivity';
import { api } from './api.ts';

/** Icons that failed to load, which every link to that page then skips instead of leaving a gap. */
const missing = new SvelteSet<string>();

/** The icon a link shows before its text, from the server's favicon route. Null for a page without one. */
export function faviconSrc(href: string): string | null {
	const src = `${FAVICON_PATH}?url=${encodeURIComponent(href)}`;
	return missing.has(src) ? null : src;
}

/** A site without an icon, or a public link viewer without a session. */
export function faviconFailed(src: string): void {
	missing.add(src);
}

/** The title of the page at `url`, or null offline or when the server cannot read it. */
export async function pageTitle(url: string): Promise<string | null> {
	const preview = await api.linkPreview({ query: { url } }).catch(() => null);
	return preview?.title ?? null;
}
