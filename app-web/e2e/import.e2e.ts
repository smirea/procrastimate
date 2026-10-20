import { expect, test } from './fixtures';

test('a Todoist backup imports once with its sections, a second import skips every task, and a wrong file changes nothing', async ({
	app,
	page,
}) => {
	await app.openSettings();
	const chooser = page.waitForEvent('filechooser');
	await app.settings().getByRole('button', { name: 'Import from Todoist' }).click();
	await (await chooser).setFiles({ name: 'notes.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
	await expect(app.settings().getByRole('alert')).toHaveText('This is not a Todoist backup zip.');
	await expect(app.importSummary()).toHaveCount(0);

	await app.importBackup();
	const summary = app.importSummary();
	for (const text of ['2 projects', '12 tasks', '0 skipped', '2 sections and 3 labels added'])
		await expect(summary).toContainText(text);
	await expect(summary.getByRole('list', { name: 'Import warnings' }).getByRole('listitem')).toHaveCount(2);

	await app.importBackup();
	for (const text of ['0 projects', '0 tasks', '12 skipped']) await expect(summary).toContainText(text);
	await page.keyboard.press('Escape');
	await expect(app.settings()).toBeHidden();

	await app.reload();
	const rows = page.getByRole('main').locator('[data-task]');
	await expect(rows).toHaveText([
		/Call the dentist/,
		/cancel/,
		/Renew passport #Travel/,
		/Water plants/,
		/Book flights.*Visit Japan/,
		/Visit Japan/,
	]);
	await expect(app.row('Call the dentist')).toContainText('Oct 22');
	await expect(app.row('Water plants')).toContainText('home');
	await app.go('No date');
	await expect(rows).toHaveText([/Fix bike Todoist date: every! 3 days/]);
	await app.nav('Long Term').click();
	await expect(page.getByRole('list', { name: 'Someday tasks' }).locator('[data-task]')).toHaveText([/Visit Japan/]);
	await expect(page.getByRole('list', { name: 'Reading tasks' }).locator('[data-task]')).toHaveCount(2);
	await app.settle();
	await page.screenshot({ path: 'test-results/sections/import.png' });
});
