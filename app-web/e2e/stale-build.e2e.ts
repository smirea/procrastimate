import { BOOT_TIMEOUT, deviceContext, expect, signInAccount, test, watchPageErrors } from './fixtures.ts';

test('a page whose shell names a chunk the last deploy deleted reloads into the current build', async ({ browser }) => {
	const context = await deviceContext(browser);
	await signInAccount(context);
	const errors = watchPageErrors(context);
	const page = await context.newPage();
	let documents = 0;
	await page.route('**/inbox', route => {
		documents++;
		return route.continue();
	});
	// The first document is the shell from before a deploy, whose root layout chunk is gone.
	await page.route(/\/_app\/immutable\/nodes\/0\.[\w-]+\.js$/, route =>
		documents === 1 ? route.fulfill({ status: 404 }) : route.continue(),
	);

	await page.goto('/inbox');
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible({ timeout: BOOT_TIMEOUT });
	expect(documents).toBe(2);
	// The old page may surface its failed import before the reload unloads it; Sentry drops it as the reload starts.
	expect((await errors()).filter(error => !error.includes('Failed to fetch dynamically imported module'))).toEqual([]);
	await context.close();
});
