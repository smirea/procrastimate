import { expect, test } from '@playwright/test';

test('every request the page makes stays on its own origin', async ({ page, baseURL }) => {
	const urls: string[] = [];
	page.on('request', request => urls.push(request.url()));

	await page.goto('/inbox');
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
	await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle');

	const loadedFonts = await page.evaluate(() =>
		[...document.fonts].filter(font => font.status === 'loaded').map(font => font.family),
	);
	expect(loadedFonts).toContain('Google Sans Flex Variable');
	const origin = new URL(baseURL!).origin;
	expect(urls.filter(url => !url.startsWith('data:') && new URL(url).origin !== origin)).toEqual([]);
});
