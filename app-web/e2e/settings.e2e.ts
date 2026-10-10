import { expect, test, type App } from './fixtures.ts';

const shoot = async (app: App, name: string) => {
	await app.page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
	await app.page.screenshot({ path: `test-results/settings-import/${name}.png` });
};

test('the settings gear opens a popover that holds the theme switch', async ({ app, page }) => {
	await expect(page.getByRole('radiogroup', { name: 'Theme' })).toHaveCount(0);
	await app.openSettings();
	await expect(app.settings().getByRole('button', { name: 'Import from Todoist' })).toBeVisible();
	await shoot(app, 'desktop-popover-light');

	await app.themeOption('Dark').click();
	await app.expectTheme('dark');
	await shoot(app, 'desktop-popover-dark');

	await page.keyboard.press('Escape');
	await expect(app.settings()).toHaveCount(0);
	await app.expectTheme('dark');
});

test('importing a Todoist backup twice adds each project and task once', async ({ app, page }) => {
	await app.openSettings();
	await app.importBackup();
	await expect(app.importSummary()).toContainText('2 projects');
	await expect(app.importSummary()).toContainText('12 tasks');
	await expect(app.importSummary()).toContainText('0 skipped');
	await expect(app.importSummary()).toContainText('3 labels added');
	await expect(app.importSummary().getByRole('list', { name: 'Import warnings' }).getByRole('listitem')).toHaveText([
		'Inbox: could not read the date "every! 3 days" on "Fix bike", kept it in notes',
		'Long Term: sections are not imported: Someday, Reading',
		'Long Term: 2 subtasks were imported as top-level tasks',
		'Job: could not read the date "jeden Montag" on "Email Sam", kept it in notes',
	]);
	await shoot(app, 'desktop-summary-light');
	await page.emulateMedia({ colorScheme: 'dark' });
	await shoot(app, 'desktop-summary-dark');
	await page.emulateMedia({ colorScheme: 'light' });

	await app.importBackup();
	await expect(app.importSummary()).toContainText('0 projects');
	await expect(app.importSummary()).toContainText('0 tasks');
	await expect(app.importSummary()).toContainText('12 skipped');
	await page.keyboard.press('Escape');

	await page.reload();
	await expect(app.page.locator('[data-task]')).toHaveText([
		/Call the dentist/,
		/cancel \[meetup\.com\]\(https:\/\/meetup\.com\)/,
		/Renew passport #Travel/,
		/Water plants/,
		/Fix bike/,
	]);
	await expect(app.row('Call the dentist')).toContainText('Oct 22');
	await expect(app.nav('Long Term')).toBeVisible();
	await app.go('Job');
	await expect(app.row('Quarterly review')).toContainText('work');
	await expect(app.row('Quarterly review')).toContainText('deep-work');
});

test('a file that is not a Todoist backup shows an error and imports nothing', async ({ app, page }) => {
	await app.openSettings();
	const chooser = page.waitForEvent('filechooser');
	await app.settings().getByRole('button', { name: 'Import from Todoist' }).click();
	await (await chooser).setFiles({ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
	await expect(app.settings().getByRole('alert')).toHaveText('This is not a Todoist backup zip.');
	await expect(app.page.locator('[data-task]')).toHaveCount(0);
});
