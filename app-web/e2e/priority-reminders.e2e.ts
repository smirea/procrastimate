import { NOW, expect, test } from './fixtures.ts';

for (const [phrase, level] of [
	['p2', 2],
	['!!', 2],
	['!!!', 1],
	['urgent', 1],
	['p3', 3],
] as const) {
	test(`"${phrase}" in quick add sets priority ${level}`, async ({ app }) => {
		await app.openQuickAdd();
		await app.taskInput().fill(`File taxes ${phrase}`);
		await expect(app.quickAdd().locator('[data-token="priority"]')).toHaveText(phrase);
		await expect(app.quickAdd().getByRole('button', { name: `Priority ${level}` })).toBeVisible();
		await app.taskInput().press('Enter');
		await app.taskInput().press('Escape');
		await expect(app.row('File taxes').getByRole('checkbox')).toHaveAttribute('style', new RegExp(`--p${level}`));
	});
}

test('picking a priority in quick add replaces the typed one', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('File taxes p1');
	await app.quickAdd().getByRole('button', { name: 'Priority 1' }).click();
	await page.getByRole('dialog', { name: 'Priority' }).getByRole('button', { name: 'Priority 3' }).click();
	await expect(page.getByRole('dialog', { name: 'Priority' })).toBeHidden();
	await expect(app.taskInput()).toHaveValue('File taxes ');
	await expect(app.quickAdd().getByRole('button', { name: 'Priority 3' })).toBeVisible();
});

test('reminders can be added from the UI and fire while the app is open', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Standup today 10:30am');
	await app.quickAdd().getByRole('button', { name: 'Add reminder' }).click();
	await page.getByRole('dialog', { name: 'Reminders' }).getByRole('button', { name: '10m before' }).click();
	await expect(app.quickAdd().getByRole('button', { name: '1 reminder' })).toBeVisible();
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await expect(app.quickAdd()).toBeHidden();

	await app
		.row('Standup')
		.getByRole('button', { name: /Standup/ })
		.click();
	await app.details().getByRole('button', { name: '1 reminder' }).click();
	await expect(page.getByRole('dialog', { name: 'Reminders' })).toContainText('10m before');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');

	await app.setNow(new Date(NOW.getTime() + 21 * 60_000));
	await expect(page.getByRole('status').filter({ hasText: 'Reminder: Standup' })).toBeVisible({ timeout: 20_000 });
});

test('a reminder typed without a due time stays and defaults to the due date', async ({ app }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Renew passport fri remind me at 9am');
	await expect(app.quickAdd().getByText('Friday 9am')).toBeVisible();
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await expect(app.row('Renew passport').getByLabel('1 reminders')).toBeVisible();
});

test('an at-due-time reminder survives a reload', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Call mom tomorrow 5pm');
	await app.quickAdd().getByRole('button', { name: 'Add reminder' }).click();
	await page.getByRole('dialog', { name: 'Reminders' }).getByRole('button', { name: 'At due time' }).click();
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await page.reload();
	await expect(app.row('Call mom').getByLabel('1 reminders')).toBeVisible();
});
