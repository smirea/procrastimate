import { expect, test } from './fixtures.ts';

const INBOX = [
	/Call the dentist/,
	/cancel \[meetup\.com\]\(https:\/\/meetup\.com\)/,
	/Renew passport #Travel/,
	/Water plants/,
	/Fix bike/,
];

test('import-pick: Import from Todoist opens a picker limited to zips', async ({ app, page, snap }) => {
	await app.openSettings();
	const chooser = page.waitForEvent('filechooser');
	await app.settings().getByRole('button', { name: 'Import from Todoist' }).tap();
	expect(await (await chooser).element().getAttribute('accept')).toBe('.zip,application/zip');
	await snap('import-pick');
	await app.importBackup('tap');
	await expect(app.importSummary()).toBeVisible();
});

test('import-read: the backup lands in the lists', async ({ app, page, snap }) => {
	await app.openSettings();
	await app.importBackup('tap');
	await expect(app.importSummary()).toBeVisible();
	await app.closeSettings();
	await expect(page.locator('[data-task]')).toHaveText(INBOX);
	await expect(app.row('Call the dentist')).toContainText('Oct 22');
	await snap('import-read');
});

test('import-summary: counts and warnings', async ({ app, snap }) => {
	await app.openSettings();
	await app.importBackup('tap');
	for (const stat of ['2 projects', '12 tasks', '0 skipped', '3 labels added']) {
		await expect(app.importSummary()).toContainText(stat);
	}
	await expect(app.importSummary()).toContainText('3 warnings');
	await expect(app.importSummary().getByRole('list', { name: 'Import warnings' }).getByRole('listitem')).toHaveText([
		'Inbox: could not read the date "every! 3 days" on "Fix bike", kept it in notes',
		'Long Term: sections are not imported: Someday, Reading',
		'Job: could not read the date "jeden Montag" on "Email Sam", kept it in notes',
	]);
	await snap('import-summary');
});

test('import-dedupe: a second import adds nothing', async ({ app, page, snap }) => {
	await app.openSettings();
	await app.importBackup('tap');
	await expect(app.importSummary()).toContainText('12 tasks');
	await app.importBackup('tap');
	await expect(app.importSummary()).toContainText('12 skipped');
	await expect(app.importSummary()).toContainText('0 projects');
	await expect(app.importSummary()).toContainText('0 tasks');
	await snap('import-dedupe');
	await app.closeSettings();
	await expect(page.locator('[data-task]')).toHaveText(INBOX);
});

test('import-error: a file that is not a backup changes nothing', async ({ app, page, snap }) => {
	await app.openSettings();
	const chooser = page.waitForEvent('filechooser');
	await app.settings().getByRole('button', { name: 'Import from Todoist' }).tap();
	await (
		await chooser
	).setFiles({ name: 'not-a-backup.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
	await expect(app.settings().getByRole('alert')).toHaveText('This is not a Todoist backup zip.');
	await snap('import-error');
	await app.closeSettings();
	await expect(page.getByText('Inbox zero')).toBeVisible();
});
