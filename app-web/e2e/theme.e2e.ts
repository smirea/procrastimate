import { expect, test } from './fixtures.ts';

test('System is the default and follows the color scheme', async ({ app, page }) => {
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await app.expectTheme('light');
});

test('Light and Dark override the color scheme and persist across reloads', async ({ app, page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.themeOption('Light').click();
	await app.expectTheme('light');
	await page.reload();
	await expect(app.themeOption('Light')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');

	await page.emulateMedia({ colorScheme: 'light' });
	await app.themeOption('Dark').click();
	await app.expectTheme('dark');
	await page.reload();
	await expect(app.themeOption('Dark')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('dark');

	await app.themeOption('System').click();
	await app.expectTheme('light');
	await page.reload();
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');
});

test('arrow keys move the theme selection', async ({ app, page }) => {
	await app.themeOption('System').focus();
	await page.keyboard.press('ArrowRight');
	await expect(app.themeOption('Light')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(app.themeOption('Dark')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('dark');
});

test('the saved theme applies before the app loads, so it never flashes', async ({ app, page }) => {
	await app.themeOption('Dark').click();
	await app.expectFirstPaintTheme('dark');

	await page.emulateMedia({ colorScheme: 'dark' });
	await app.themeOption('Light').click();
	await app.expectFirstPaintTheme('light');

	await app.themeOption('System').click();
	await app.expectFirstPaintTheme('dark');
});

test('glass turns solid when the device asks for more contrast', async ({ app, page }) => {
	const sidebar = page.getByRole('navigation', { name: 'Main' });
	await expect(sidebar).not.toHaveCSS('backdrop-filter', 'none');
	await page.emulateMedia({ contrast: 'more' });
	await expect(sidebar).toHaveCSS('backdrop-filter', 'none');
	await expect(sidebar).toHaveCSS('background-color', 'rgb(251, 251, 252)');
	await app.themeOption('Dark').click();
	await expect(sidebar).toHaveCSS('background-color', 'rgb(38, 38, 43)');
});

test('popovers open without motion under reduced motion', async ({ app, page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Set due date' }).click();
	const popover = page.getByRole('dialog', { name: 'Due date' });
	await expect(popover).toBeVisible();
	expect(await popover.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
});
