import { expect, NOW, test, watchPageErrors } from './fixtures';

test('an error thrown in a handler or a timer under the pinned clock counts as a page error', async ({ browser }) => {
	const { baseURL, timezoneId, viewport } = test.info().project.use;
	const context = await browser.newContext({ baseURL, timezoneId, viewport });
	const errors = watchPageErrors(context);
	const page = await context.newPage();
	await page.clock.setFixedTime(NOW);
	await page.goto('/api/status');
	await page.evaluate(() => {
		console.error('a logged line is not a page error');
		setTimeout(() => {
			throw new Error('thrown in a timer');
		});
		document.body.addEventListener('click', () => {
			throw new Error('thrown in a handler');
		});
	});
	await page.locator('body').click();
	await expect
		.poll(async () => (await errors()).toSorted())
		.toEqual(['Error: thrown in a handler', 'Error: thrown in a timer']);
	await context.close();
});
