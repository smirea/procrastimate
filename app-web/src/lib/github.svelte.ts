import { githubUrl, type GithubItem, type GithubRef } from 'shared/github.ts';
import { SvelteMap } from 'svelte/reactivity';
import { api } from './api.ts';

const FRESH_MS = 60_000;

/** What the server last read for each attached issue or pull request, by URL, kept while the page lives. */
const items = new SvelteMap<string, GithubItem>();
const readAt = new Map<string, number>();

async function refresh(url: string) {
	readAt.set(url, Date.now());
	const item = await api.github({ query: { url } }).catch(() => null);
	if (item) items.set(url, item);
	else readAt.delete(url);
}

/**
 * The live title and state, or undefined until the first read lands. Reading it asks the server again once the last
 * answer is a minute old, so a merged PR shows as merged the next time its task opens.
 */
export function githubItem(ref: GithubRef): GithubItem | undefined {
	const url = githubUrl(ref);
	if (Date.now() - (readAt.get(url) ?? 0) > FRESH_MS) void refresh(url);
	return items.get(url);
}
