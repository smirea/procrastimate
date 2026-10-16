import { expect, test } from './fixtures';

test('a monthly repeat on the 31st lands on the last day of February and returns to the 31st', async ({
	app,
	page,
}) => {
	await app.setNow(new Date('2027-01-20T10:00:00Z'));
	await page.reload();
	await app.openQuickAdd();
	await app.taskInput().fill('Pay rent every 31st');
	await expect(app.quickAdd().getByText('Every month on the 31st')).toBeVisible();
	await app.taskInput().press('Enter');
	await expect(app.quickAdd()).toBeHidden();

	const row = app.row('Pay rent');
	await expect(row.getByRole('img', { name: 'Repeats every month on the 31st' })).toBeVisible();
	const checkbox = row.getByRole('checkbox');
	for (const next of ['Feb 28', 'Mar 31']) {
		await checkbox.click();
		await expect(page.getByText(new RegExp(`Completed “Pay rent”, next due .*${next}`))).toBeVisible();
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(next);
	}
});

test('a repeat on the last Friday of the month rolls to next month’s last Friday', async ({ app, page }) => {
	await app.setNow(new Date('2026-10-14T10:00:00Z'));
	await page.reload();
	await app.openQuickAdd();
	await app.taskInput().fill('Review budget every last Friday');
	await expect(app.quickAdd().getByText('Every month on the last Fri')).toBeVisible();
	await app.taskInput().press('Enter');
	await expect(app.quickAdd()).toBeHidden();

	const row = app.row('Review budget');
	await expect(row.getByRole('img', { name: 'Repeats every month on the last Fri' })).toBeVisible();
	await expect(row).toContainText('Oct 30');
	await row.getByRole('checkbox').click();
	await expect(page.getByText(/Completed “Review budget”, next due .*Nov 27/)).toBeVisible();
});

test('the repeat menu offers the due date’s weekday of the month', async ({ app, page }) => {
	await app.setNow(new Date('2026-10-14T10:00:00Z'));
	await page.reload();
	await app.add('Pay card oct 19');
	await app.row('Pay card').click();
	await app.details().getByRole('button', { name: 'Set repeat' }).click();
	await page.getByRole('button', { name: 'Every month on the 3rd Mon' }).click();
	await expect(app.details().getByRole('button', { name: 'Repeats every month on the 3rd Mon' })).toBeVisible();
	await app.details().getByRole('button', { name: 'Repeats every month on the 3rd Mon' }).click();
	await page.getByRole('spinbutton', { name: 'Repeat interval' }).fill('2');
	await page.getByRole('combobox', { name: 'Repeat unit' }).selectOption('month');
	await page.getByRole('button', { name: 'Set', exact: true }).click();
	await expect(app.details().getByRole('button', { name: 'Repeats every 2 months on the 3rd Mon' })).toBeVisible();
});

test('completing a recurring task moves it and its reminder to the next occurrence', async ({ app, page }) => {
	await app.add('Standup every weekday 9am remind me 10m before');
	const row = app.row('Standup');
	await expect(row).toContainText('Tomorrow 9am');
	await expect(row.getByRole('img', { name: 'Repeats every weekday' })).toBeVisible();
	const checkbox = row.getByRole('checkbox', { name: 'Complete Standup' });

	await checkbox.click();
	await expect(page.getByText('Completed “Standup”, next due Friday 9am')).toBeVisible();
	await expect(row.filter({ hasText: 'Friday 9am' })).toBeVisible();
	await expect(row).toHaveCount(1);
	await expect(checkbox).toHaveAttribute('aria-checked', 'false');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(row.filter({ hasText: 'Tomorrow 9am' })).toBeVisible();
	await expect(row).toHaveCount(1);

	await checkbox.click();
	await expect(row.filter({ hasText: 'Friday 9am' })).toBeVisible();
	await expect(row).toHaveCount(1);
	await app.setNow(new Date('2026-10-16T08:51:00Z'));
	await page.reload();
	await expect(page.getByText('Reminder: Standup')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Today' }).locator('[data-task="Standup"]')).toContainText('9am');
});
