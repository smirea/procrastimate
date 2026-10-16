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
