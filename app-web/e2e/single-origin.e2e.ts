import { expect, test, unique } from './fixtures.ts';

test('single-origin: no request leaves the page’s origin, sync included', async ({ context, page, app }) => {
	const origins = new Set<string>();
	const paths = new Set<string>();
	context.on('request', request => {
		const url = new URL(request.url());
		if (!/^(http|ws)s?:$/.test(url.protocol)) return;
		origins.add(url.origin.replace(/^ws/, 'http'));
		paths.add(url.pathname);
	});
	await app.reload();
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	const title = unique('Stays home');
	await app.add(title);
	await expect.poll(() => app.pending(), { timeout: 15_000 }).toBe(0);
	expect([...origins]).toEqual([new URL(page.url()).origin]);
	// Chromium runs PowerSync's stream in a SharedWorker, whose requests Playwright never reports; WebKit's are seen.
	if (test.info().project.name === 'mobile') {
		expect([...paths].filter(path => path.startsWith('/api/powersync/'))).not.toEqual([]);
	}
});
