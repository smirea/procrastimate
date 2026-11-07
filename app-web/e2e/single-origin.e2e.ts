import { expect, test, unique } from './fixtures.ts';

test(
	'single-origin: no request leaves the page’s origin, sync included',
	{ tag: '@webkit' },
	async ({ context, page, app }) => {
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
		await app.synced();
		expect([...origins]).toEqual([new URL(page.url()).origin]);
		expect([...paths].filter(path => path === '/api/sync')).not.toEqual([]);
	},
);
