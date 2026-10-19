import { expect, test } from './fixtures.ts';

test.use({ serviceWorkers: 'allow' });

test('a cold launch offline opens the app from the cached shell', async ({ app, page, context }) => {
	await app.add('Water the plants');
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
	await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
	await app.go('No date');
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'No date' })).toBeVisible();
	await expect(app.row('Water the plants')).toBeVisible();
	await context.setOffline(false);
});
