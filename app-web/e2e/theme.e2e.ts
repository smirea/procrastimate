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
	await app.expectShellTheme('dark');

	await page.emulateMedia({ colorScheme: 'dark' });
	await app.themeOption('Light').click();
	await app.expectShellTheme('light');

	await app.themeOption('System').click();
	await app.expectShellTheme('dark');
});
