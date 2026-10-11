import { expect, test } from './fixtures.ts';

test('settings-sheet: Settings opens as a sheet with the theme, notifications, import, and delete', async ({
	app,
	snap,
}) => {
	await app.openSettings();
	await expect(app.themeOption('System')).toBeVisible();
	await expect(app.settings().getByText(/^Notifications/)).toBeVisible();
	await expect(app.settings().getByRole('button', { name: 'Import from Todoist' })).toBeVisible();
	await expect(app.settings().getByRole('button', { name: 'Delete all data' })).toBeVisible();
	await expect(app.settings().getByText('Sync')).toHaveCount(0);
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
