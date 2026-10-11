import { expect, test } from './fixtures.ts';

test('theme-system: System follows the device appearance live', async ({ app, page, snap }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await app.openSettings();
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');
	await snap('theme-system-light');
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');
	await snap('theme-system-dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await app.expectTheme('light');
});

test('theme-override: Light and Dark override the device appearance', async ({ app, page, snap }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.openSettings();
	await app.themeOption('Light').tap();
	await app.expectTheme('light');
	await page.emulateMedia({ colorScheme: 'light' });
	await app.themeOption('Dark').tap();
	await app.expectTheme('dark');
	await snap('theme-override');
	await app.themeOption('System').tap();
	await app.expectTheme('light');
});

test('theme-persist: the choice is kept across a relaunch', async ({ app, page, snap }) => {
	await app.openSettings();
	await app.themeOption('Dark').tap();
	await app.expectTheme('dark');
	await app.closeSettings();
	await page.reload();
	await app.expectTheme('dark');
	await app.openSettings();
	await expect(app.themeOption('Dark')).toHaveAttribute('aria-checked', 'true');
	await snap('theme-persist');
	await app.themeOption('System').tap();
	await app.closeSettings();
	await page.reload();
	await app.expectTheme('light');
});

test('theme-first-paint: the saved theme paints the first frame', async ({ app }) => {
	await app.openSettings();
	await app.themeOption('Dark').tap();
	await app.closeSettings();
	await app.expectFirstPaintTheme('dark');
});
