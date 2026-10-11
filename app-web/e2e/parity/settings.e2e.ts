import { expect, test } from './fixtures.ts';

test('settings-sheet: Settings opens as a sheet with the theme, sync, and import', async ({ app, snap }) => {
	await app.openSettings();
	await expect(app.themeOption('System')).toBeVisible();
	await expect(app.settings().getByRole('button', { name: 'Import from Todoist' })).toBeVisible();
	await expect(app.settings().getByRole('button', { name: 'Set up sync' })).toBeVisible();
	await snap('settings-sheet');
	await app.closeSettings();
});

test('settings-theme: the Theme control switches the theme', async ({ app, snap }) => {
	await app.openSettings();
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');
	await app.themeOption('Dark').tap();
	await expect(app.themeOption('Dark')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('dark');
	await snap('settings-theme');
});
