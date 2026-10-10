import { expect, test } from './fixtures.ts';

test('completing a recurring task moves it and its reminder to the next occurrence', async ({ app, page }) => {
	await app.add('Standup every weekday 9am remind me 10m before');
	const row = app.row('Standup');
	await expect(row).toContainText('Tomorrow 9am');
	await expect(row.getByRole('img', { name: 'Repeats every weekday' })).toBeVisible();

	await row.getByRole('checkbox', { name: 'Complete Standup' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Completed “Standup”, next due Friday 9am' })).toBeVisible();
	await expect(row).toContainText('Friday 9am');
	await expect(row.getByRole('checkbox', { name: 'Complete Standup' })).toHaveAttribute('aria-checked', 'false');

	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(row).toContainText('Tomorrow 9am');
	await row.getByRole('checkbox', { name: 'Complete Standup' }).click();
	await expect(row).toContainText('Friday 9am');

	await app.setNow(new Date('2026-10-16T08:51:00Z'));
	await page.reload();
	await expect(page.getByRole('status').filter({ hasText: 'Reminder: Standup' })).toBeVisible();
	await expect(app.row('Standup')).toContainText('Today 9am');
});

test('a repeating task notifies at each next occurrence’s due time with no reminder set', async ({ app, page }) => {
	const toast = page.getByRole('status').filter({ hasText: 'Reminder: Call mom' });
	await app.add('Call mom every day 10:30am');
	const row = app.row('Call mom');
	await expect(row).toContainText('Today 10:30am');

	await row.getByRole('checkbox', { name: 'Complete Call mom' }).click();
	await expect(row).toContainText('Tomorrow 10:30am');
	await app.setNow(new Date('2026-10-14T10:31:00Z'));
	await page.reload();
	await expect(app.row('Call mom')).toContainText('Tomorrow 10:30am');
	await expect(toast).toHaveCount(0);

	await app.setNow(new Date('2026-10-15T10:31:00Z'));
	await page.reload();
	await expect(toast).toBeVisible();
	await app.row('Call mom').getByRole('checkbox', { name: 'Complete Call mom' }).click();
	await expect(app.row('Call mom')).toContainText('Tomorrow 10:30am');

	await app.setNow(new Date('2026-10-16T10:31:00Z'));
	await page.reload();
	await expect(toast).toBeVisible();
});

test('task details set, change, and clear a repeat', async ({ app, page }) => {
	await app.add('Water plants');
	await app
		.row('Water plants')
		.getByRole('button', { name: /Water plants/ })
		.click();
	const details = app.details();
	const menu = page.getByRole('dialog', { name: 'Repeat' });

	await details.getByRole('button', { name: 'Set repeat' }).click();
	await menu.getByRole('button', { name: 'Every Wed' }).click();
	await expect(details.getByRole('button', { name: 'Repeats every Wed' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Due Today' })).toBeVisible();

	await details.getByRole('button', { name: 'Repeats every Wed' }).click();
	await menu.getByRole('spinbutton', { name: 'Repeat interval' }).fill('3');
	await menu.getByRole('combobox', { name: 'Repeat unit' }).selectOption('day');
	await menu.getByRole('button', { name: 'Set' }).click();
	await expect(details.getByRole('button', { name: 'Repeats every 3 days' })).toBeVisible();
	await expect(menu).toBeHidden();
	await page.screenshot({ path: 'test-results/recurrence-details.png' });

	await page.reload();
	await app
		.row('Water plants')
		.getByRole('button', { name: /Water plants/ })
		.click();
	await expect(details.getByRole('button', { name: 'Repeats every 3 days' })).toBeVisible();

	const title = details.getByRole('textbox', { name: 'Title' });
	await title.fill('Water plants every mon');
	await title.press('Enter');
	await expect(details.getByRole('button', { name: 'Repeats every Mon' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Due Monday' })).toBeVisible();

	await details.getByRole('button', { name: 'Repeats every Mon' }).click();
	await menu.getByRole('button', { name: 'Don’t repeat' }).click();
	await expect(details.getByRole('button', { name: 'Set repeat' })).toBeVisible();

	await details.getByRole('button', { name: 'Set repeat' }).click();
	await menu.getByRole('button', { name: 'Every day' }).click();
	await details.getByRole('button', { name: 'Due Monday' }).click();
	await page.getByRole('dialog', { name: 'Due date' }).getByRole('button', { name: 'No date' }).click();
	await expect(details.getByRole('button', { name: 'Set repeat' })).toBeVisible();
});
