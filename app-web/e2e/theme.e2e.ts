import { expect, test } from './fixtures';

test('System follows the device, and Light or Dark overrides it, survives a reload, and paints the first frame', async ({
	app,
	page,
}) => {
	await app.openSettings();
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');

	await app.themeOption('Light').click();
	await app.expectTheme('light');
	await app.expectFirstPaintTheme('light');
	await app.openSettings();
	await expect(app.themeOption('Light')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');

	await page.emulateMedia({ colorScheme: 'light' });
	await app.themeOption('Dark').click();
	await app.expectTheme('dark');
	await app.expectFirstPaintTheme('dark');
	await app.openSettings();
	await expect(app.themeOption('Dark')).toHaveAttribute('aria-checked', 'true');

	await app.themeOption('System').click();
	await app.expectTheme('light');
	await app.expectFirstPaintTheme('light');
	await app.openSettings();
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
});

test('a theme color recolors the accent in both themes, survives a reload, and paints the first frame', async ({
	app,
	page,
}) => {
	await app.openSettings();
	await expect(app.accentOption('Frost')).toHaveAttribute('aria-checked', 'true');
	expect(await app.accent()).toBe('#0067bd');

	await app.accentOption('Violet').click();
	await expect(app.accentOption('Violet')).toHaveAttribute('aria-checked', 'true');
	await expect.poll(() => app.accent()).toBe('#823ee1');
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect.poll(() => app.accent()).toBe('#b28dff');

	await app.accentOption('Violet').press('ArrowRight');
	await expect(app.accentOption('Pink')).toHaveAttribute('aria-checked', 'true');
	await expect(app.accentOption('Pink')).toBeFocused();

	await page.addInitScript(() => {
		new MutationObserver((_, observer) => {
			if (!document.body) return;
			observer.disconnect();
			sessionStorage.setItem(
				'first-paint-accent',
				getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
			);
		}).observe(document, { childList: true, subtree: true });
	});
	await app.reload();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('first-paint-accent'))).toBe('#ff6fb1');
	await app.openSettings();
	await expect(app.accentOption('Pink')).toHaveAttribute('aria-checked', 'true');

	await app.accentOption('Frost').click();
	expect(await page.evaluate(() => localStorage.getItem('procrastimate-accent'))).toBeNull();
});
