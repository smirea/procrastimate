import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { iconLinks, pageTitle, publicHost } from './link-preview';
import { type Session, signUp, testApp, type TestApp } from './test-app';

let app: TestApp;
let owner: Session;
beforeAll(async () => {
	app = await testApp();
	owner = await signUp(app, 'Owner');
});
afterAll(() => app.close());

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Stands in for the internet: each URL answers its response, anything else a 404, and every request is logged. */
function web(pages: Record<string, () => Response>): string[] {
	const asked: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input instanceof Request ? input.url : input);
		asked.push(url);
		return pages[url]?.() ?? new Response('missing', { status: 404 });
	}) as typeof fetch;
	return asked;
}

const html = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });

describe('pageTitle', () => {
	test.each([
		['<title>Plain</title>', 'Plain'],
		[
			'<head><title>\n  Tom &amp; Jerry &#8211; &quot;Cartoons&quot; &#x1F600;\n</title></head>',
			'Tom & Jerry – "Cartoons" 😀',
		],
		['<meta content="From OG" property="og:title"><title> </title>', 'From OG'],
		["<meta name='twitter:title' content='Tweet'>", 'Tweet'],
		['<body><title>In an SVG</title></body>', null],
		['no markup', null],
		[`<title>${'a'.repeat(199)}😀 more</title>`, 'a'.repeat(199)],
	])('%p reads %p', (page, title) => {
		expect(pageTitle(page, new URL('https://site.com/page'))).toBe(title);
	});

	const MAPS_PLACE =
		'<title>Google Maps</title><meta content="HEAT Bootcamp · 5.0★(190) · Fitness center" property="og:title">';
	test.each([
		['a Google Maps place reads its name alone', 'https://www.google.com/maps?q=HEAT', MAPS_PLACE, 'HEAT Bootcamp'],
		[
			'a map that is not a place keeps the tab title',
			'https://www.google.com/maps/@30,-97,12z',
			'<title>Google Maps</title><meta content="Google Maps" property="og:title">',
			'Google Maps',
		],
		['the same tags on another site keep the tab title', 'https://site.com/maps', MAPS_PLACE, 'Google Maps'],
	])('%s', (_, url, page, title) => {
		expect(pageTitle(page, new URL(url))).toBe(title);
	});
});

describe('iconLinks', () => {
	test('ranks icons nearest 32 px first, then unsized ones, then the touch icon, and skips SVG', () => {
		const page = `
			<link rel="apple-touch-icon" href="/touch.png">
			<link rel="icon" href="/any.png">
			<link rel="icon" type="image/svg+xml" href="/logo.svg">
			<link href="https://cdn.site.com/16.png" rel="shortcut icon" sizes="16x16">
			<link rel="icon" sizes="32x32" href="32.png">
			<link rel="stylesheet" href="/style.css">`;
		expect(iconLinks(page, new URL('https://site.com/a/')).map(String)).toEqual([
			'https://site.com/a/32.png',
			'https://cdn.site.com/16.png',
			'https://site.com/any.png',
			'https://site.com/touch.png',
		]);
	});
});

describe('publicHost', () => {
	test.each([
		['example.com', true],
		['docs.google.com', true],
		['localhost', false],
		['127.0.0.1', false],
		['10.0.0.8', false],
		['printer.local', false],
		['intranet', false],
		['a.b.internal', false],
		['[::1]', false],
	])('%p is public: %p', (host, expected) => {
		expect(publicHost(host)).toBe(expected);
	});
});

describe('GET /api/link-preview', () => {
	const preview = (url: string, session: Session | null = owner) =>
		app.fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { headers: session?.headers ?? {} });

	test('answers the title of the page a redirect lands on', async () => {
		web({
			'https://short.link/x': () => new Response(null, { status: 301, headers: { location: 'https://site.com/page' } }),
			'https://site.com/page': html('<title>The page</title>'),
		});
		expect(await (await preview('https://short.link/x')).json()).toEqual({ title: 'The page' });
	});

	test('reads a pasted www. address over https', async () => {
		web({ 'https://www.site.com/page': html('<title>Bare</title>') });
		expect(await (await preview('www.site.com/page')).json()).toEqual({ title: 'Bare' });
	});

	test('answers null for a private host, a redirect to one, and a page that is not HTML', async () => {
		const asked = web({
			'https://site.com/hop': () =>
				new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
			'https://site.com/file': () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
		});
		for (const url of ['http://localhost:6120/', 'https://site.com/hop', 'https://site.com/file']) {
			expect(await (await preview(url)).json()).toEqual({ title: null });
		}
		expect(asked).toEqual(['https://site.com/hop', 'https://site.com/file']);
	});

	test('needs a session', async () => {
		expect((await preview('https://site.com', null)).status).toBe(401);
	});
});

describe('GET /api/favicon', () => {
	const favicon = (url: string, session: Session | null = owner) =>
		app.fetch(`/api/favicon?url=${encodeURIComponent(url)}`, { headers: session?.headers ?? {} });

	test('answers the icon the page a link lands on declares, cached for a week', async () => {
		web({
			'https://short.link/x': () =>
				new Response(null, { status: 302, headers: { location: 'https://site.com/maps?q=1' } }),
			'https://site.com/maps?q=1': html('<link rel="icon" href="//cdn.site.com/maps.png">'),
			'https://cdn.site.com/maps.png': png,
		});
		const response = await favicon('https://short.link/x');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('cache-control')).toBe('private, max-age=604800');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
	});

	test('falls back to /favicon.ico, and answers a miss cached for a day', async () => {
		web({ 'https://plain.com/favicon.ico': png });
		expect((await favicon('https://plain.com/a/page')).status).toBe(200);
		const miss = await favicon('https://none.com/page');
		expect(miss.status).toBe(404);
		expect(miss.headers.get('cache-control')).toBe('private, max-age=86400');
	});

	test('refuses a private host and a caller without a session', async () => {
		expect((await favicon('http://localhost/x')).status).toBe(400);
		expect((await favicon('not a url')).status).toBe(400);
		expect((await favicon('https://site.com/', null)).status).toBe(401);
	});
});
