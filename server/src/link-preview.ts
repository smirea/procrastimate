import { FAVICON_PATH } from '../../shared/links';
import { readActor } from './actor';
import type { App } from './app';
import { errorResponse } from './errors';
import { identify } from './sentry';

/**
 * What a pasted link shows: the page's title, which the client writes into the text as `[title](url)`, and the site's
 * icon, which every client draws before a link. Both are fetched here because a browser cannot read another origin's
 * page, and the web client only talks to its own. See `docs/decisions/link-previews.md`.
 */

const TIMEOUT_MS = 5000;
const PAGE_BYTES = 2 * 1024 * 1024;
const ICON_BYTES = 256 * 1024;
const REDIRECTS = 5;
const TITLE_LENGTH = 200;
/** The link expanders' token gets the server-rendered metadata from sites that refuse unknown bots, such as the NYT. */
const AGENT = 'Mozilla/5.0 (compatible; ProcrastiMate link preview; facebookexternalhit/1.1)';

const DAY_S = 24 * 60 * 60;

/**
 * Only names of public sites: no IP literals, `localhost`, or single-label and private-suffix names. The Worker cannot
 * reach a private network anyway, but the Bun dev server would fetch whatever its machine reaches.
 */
export function publicHost(host: string): boolean {
	const name = host.toLowerCase();
	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return false;
	if (/^[\d.]+$/.test(name)) return false;
	return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(name);
}

/**
 * Follows redirects by hand, so each hop's host is checked, and answers where it landed. Null for a refused host, a
 * timeout, or no answer.
 */
async function fetchPublic(url: URL, accept: string): Promise<{ response: Response; url: URL } | null> {
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	let at = url;
	for (let hop = 0; hop <= REDIRECTS; hop++) {
		if ((at.protocol !== 'https:' && at.protocol !== 'http:') || !publicHost(at.hostname)) return null;
		const response = await fetch(at, { redirect: 'manual', signal, headers: { 'user-agent': AGENT, accept } }).catch(
			() => null,
		);
		if (!response) return null;
		const location = response.headers.get('location');
		if (response.status < 300 || response.status >= 400 || !location) return { response, url: at };
		await response.body?.cancel();
		const next = URL.parse(location, at);
		if (!next) return null;
		at = next;
	}
	return null;
}

/** At most `limit` bytes of the body, so a huge or endless page costs no more than its head. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (size < limit) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.byteLength;
		}
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => {});
	}
	const out = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/**
 * The page's head, read until `</head>` or `<body`, at most `PAGE_BYTES`: some heads are large, as YouTube's puts the
 * `<title>` 770 KB in.
 */
async function fetchPage(url: URL): Promise<{ html: string; url: URL } | null> {
	const fetched = await fetchPublic(url, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
	const response = fetched?.response;
	const type = response?.headers.get('content-type') ?? '';
	if (!fetched || !response?.ok || !response.body || !/html/i.test(type)) {
		await response?.body?.cancel();
		return null;
	}
	const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1];
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder(charset ?? 'utf-8');
	} catch {
		decoder = new TextDecoder('utf-8');
	}
	const reader = response.body.getReader();
	let html = '';
	let size = 0;
	try {
		while (size < PAGE_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			// Searching from just before the new chunk finds a tag split across two chunks.
			const from = Math.max(0, html.length - 6);
			html += decoder.decode(value, { stream: true });
			if (/<\/head>|<body\b/i.test(html.slice(from))) break;
		}
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => {});
	}
	return { html, url: fetched.url };
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	middot: '·',
	bull: '•',
	copy: '©',
	reg: '®',
	trade: '™',
};

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
		const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
	});
}

/** Each tag's attributes by lowercased name, for `<meta>` and `<link>` tags, whose attributes come in any order. */
function tags(html: string, name: string): Record<string, string>[] {
	const found: Record<string, string>[] = [];
	for (const [tag] of html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))) {
		const attributes: Record<string, string> = {};
		for (const [, key, double, single, bare] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
			attributes[key!.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
		}
		found.push(attributes);
	}
	return found;
}

const tidy = (title: string) => {
	const text = decodeEntities(title).replace(/\s+/g, ' ').trim();
	if (!text) return null;
	// A cut through an emoji would leave half a surrogate pair, which Swift's JSON decoder refuses.
	const end = /[\ud800-\udbff]/.test(text[TITLE_LENGTH - 1] ?? '') ? TITLE_LENGTH - 1 : TITLE_LENGTH;
	return text.slice(0, end);
};

/** Each `<meta>` tag's `content` by its `property` or `name`, lowercased, the first of each kept. */
function metaContent(head: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const meta of tags(head, 'meta')) {
		const key = (meta.property ?? meta.name)?.toLowerCase();
		if (key && meta.content && !found.has(key)) found.set(key, meta.content);
	}
	return found;
}

/**
 * Sites whose `<title>` names the site rather than the page, each with where its page's own name is. A rule that
 * finds nothing falls back to the general one.
 */
const SITE_TITLES: { matches: (url: URL) => boolean; title: (meta: Map<string, string>) => string | undefined }[] = [
	{
		// A place reads `Google Maps` in its tab; `og:title` is `HEAT Bootcamp · 5.0★(190) · Fitness center`, and the
		// rating and category after the name would go stale in a task title.
		matches: url => /(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname.startsWith('/maps'),
		title: meta => {
			const name = meta.get('og:title')?.split(' · ')[0];
			return name === 'Google Maps' ? undefined : name;
		},
	},
];

/**
 * The page's own name: a site rule's, else the `<title>` the browser tab shows, else the Open Graph or Twitter title,
 * which pages built by script often only set. `url` is where the page was read, after redirects.
 */
export function pageTitle(html: string, url: URL): string | null {
	const head = html.split(/<body\b/i)[0]!;
	const meta = metaContent(head);
	const site = SITE_TITLES.find(rule => rule.matches(url))?.title(meta);
	const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
	for (const candidate of [site, title, meta.get('og:title'), meta.get('twitter:title')]) {
		const tidied = candidate && tidy(candidate);
		if (tidied) return tidied;
	}
	return null;
}

/**
 * The page's declared icons, best first: an `icon` sized nearest 32 px, then unsized ones, then the larger Apple
 * touch icon. SVG icons are skipped, since iOS cannot draw them as an image.
 */
export function iconLinks(html: string, base: URL): URL[] {
	const head = html.split(/<body\b/i)[0]!;
	const ranked = tags(head, 'link').flatMap(link => {
		const rel = (link.rel ?? '').toLowerCase().split(/\s+/);
		const href = link.href && URL.parse(link.href, base);
		if (!href || /svg/i.test(link.type ?? '') || /\.svg($|\?)/i.test(href.pathname)) return [];
		const size = Math.max(0, ...(link.sizes ?? '').split(/\s+/).map(s => parseInt(s, 10) || 0));
		if (rel.includes('icon')) return [{ href, rank: size ? Math.abs(size - 32) : 100 }];
		if (rel.includes('apple-touch-icon')) return [{ href, rank: 1000 }];
		return [];
	});
	return ranked.toSorted((a, b) => a.rank - b.rank).map(icon => icon.href);
}

/** The page's title, or null when it cannot be read: a refused host, no HTML, or no answer in time. */
export async function linkTitle(url: string): Promise<string | null> {
	// A pasted `www.` address has no scheme, which links read as `https://`.
	const parsed = URL.parse(/^https?:\/\//i.test(url) ? url : `https://${url}`);
	if (!parsed) return null;
	const page = await fetchPage(parsed);
	return page && pageTitle(page.html, page.url);
}

async function fetchIcon(url: URL): Promise<{ type: string; bytes: Uint8Array<ArrayBuffer> } | null> {
	const response = (await fetchPublic(url, 'image/*'))?.response;
	const type = response?.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
	if (!response?.ok || !type.startsWith('image/') || type.includes('svg')) {
		await response?.body?.cancel();
		return null;
	}
	const bytes = await readCapped(response, ICON_BYTES + 1);
	return bytes?.byteLength && bytes.byteLength <= ICON_BYTES ? { type, bytes } : null;
}

/**
 * `GET /api/favicon?url=`: the icon of the page a link opens, from the icons it declares after redirects, else its
 * site's `/favicon.ico`. By page, not by host: a short link such as `maps.app.goo.gl` lands on Google Maps, whose pin
 * differs from both the shortener's icon and Google's. Browsers and `URLCache` keep it for a week, and keep a miss
 * for a day, so each device asks once per link.
 */
export async function faviconRoute(request: Request, app: App): Promise<Response> {
	if (request.method !== 'GET') return errorResponse('NOT_FOUND', 'Not found');
	const actor = await readActor(request, app);
	if (!actor) return errorResponse('UNAUTHORIZED', 'Not signed in');
	identify(actor);
	const url = URL.parse(new URL(request.url).searchParams.get('url') ?? '');
	if (!url || !/^https?:$/.test(url.protocol) || !publicHost(url.hostname)) {
		return errorResponse('BAD_REQUEST', 'Needs the web address of a public site');
	}
	const page = await fetchPage(url);
	const candidates = [...(page ? iconLinks(page.html, page.url) : []), new URL('/favicon.ico', page?.url ?? url)];
	for (const candidate of candidates.slice(0, 4)) {
		const icon = await fetchIcon(candidate);
		if (icon) {
			return new Response(icon.bytes, {
				headers: {
					'Content-Type': icon.type,
					'Cache-Control': `private, max-age=${7 * DAY_S}`,
					'X-Content-Type-Options': 'nosniff',
				},
			});
		}
	}
	return new Response(null, { status: 404, headers: { 'Cache-Control': `private, max-age=${DAY_S}` } });
}

export const isFaviconRoute = (request: Request) => new URL(request.url).pathname === FAVICON_PATH;
