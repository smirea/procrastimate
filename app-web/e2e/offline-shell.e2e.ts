import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

test.use({ serviceWorkers: 'allow' });

async function controlled(page: Page) {
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
	await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

/**
 * Empties the browser's HTTP cache, so what loads offline can only come from the service worker's shell, as after a
 * deploy or an eviction rather than a reload a minute after the last visit.
 */
async function clearHttpCache(context: BrowserContext, page: Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('Network.clearBrowserCache');
	await cdp.detach();
}

/**
 * Makes every request the service worker sends wait `latency` ms. Playwright's routes never see them, so this goes
 * through the worker's own DevTools target.
 */
async function slowServiceWorker(browser: Browser, latency: number) {
	const cdp = await browser.newBrowserCDPSession();
	const { targetInfos } = await cdp.send('Target.getTargets');
	const worker = targetInfos.find(target => target.type === 'service_worker');
	if (!worker) throw new Error('no service worker target');
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: false });
	let id = 0;
	const send = (method: string, params: object = {}) =>
		cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++id, method, params }) });
	await send('Network.enable');
	await send('Network.emulateNetworkConditions', {
		offline: false,
		latency,
		downloadThroughput: -1,
		uploadThroughput: -1,
	});
}

test('a cold launch offline, or on a connection that barely answers, opens the app from the cached shell', async ({
	app,
	page,
	context,
	browser,
}) => {
	await app.add('Water the plants');
	await controlled(page);
	await app.go('No date');
	await clearHttpCache(context, page);
	await context.setOffline(true);
	await app.reload();
	await expect(page.getByRole('heading', { name: 'No date' })).toBeVisible();
	await expect(app.row('Water the plants')).toBeVisible();
	await context.setOffline(false);

	await slowServiceWorker(browser, 30_000);
	const started = Date.now();
	await page.reload();
	await expect(app.row('Water the plants')).toBeVisible();
	expect(Date.now() - started).toBeLessThan(5000);
});
