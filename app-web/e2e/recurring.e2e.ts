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

test('a weekday list with a time repeats on each listed day and notifies at each', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Gym mon wed fri 7am');
	await expect(app.quickAdd().getByText('Every Mon, Wed, Fri', { exact: true })).toBeVisible();
	await expect(app.quickAdd().getByText('Friday 7am', { exact: true })).toBeVisible();
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await app.taskInput().press('Escape');

	const row = app.row('Gym');
	await expect(row).toContainText('Friday 7am');
	await expect(row.getByRole('img', { name: 'Repeats every Mon, Wed, Fri' })).toBeVisible();
	await row.getByRole('button', { name: /Gym/ }).click();
	await expect(app.details().getByRole('button', { name: 'Repeats every Mon, Wed, Fri' })).toHaveText(
		'Every Mon, Wed, Fri',
	);
	await page.keyboard.press('Escape');
	await expect(app.details()).toBeHidden();
	await row.getByRole('checkbox', { name: 'Complete Gym' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Completed “Gym”, next due Monday 7am' })).toBeVisible();
	await expect(row).toContainText('Monday 7am');

	await app.setNow(new Date('2026-10-19T07:01:00Z'));
	await page.reload();
	await expect(page.getByRole('status').filter({ hasText: 'Reminder: Gym' })).toBeVisible();
});

test('a weekday list in prose stays text while a slashed list repeats', async ({ app }) => {
	await app.add('Discuss mon wed plan', 'Yoga tue/thu');
	await expect(app.row('Discuss mon wed plan')).toHaveText('Discuss mon wed plan');
	await expect(app.row('Yoga')).toContainText('Tomorrow');
	await expect(app.row('Yoga').getByRole('img', { name: 'Repeats every Tue, Thu' })).toBeVisible();
});

test('the repeat menu toggles weekdays and keeps the last one on', async ({ app, page }) => {
	await app.add('Water plants');
	const open = () =>
		app
			.row('Water plants')
			.getByRole('button', { name: /Water plants/ })
			.click();
	await open();
	const details = app.details();
	const menu = page.getByRole('dialog', { name: 'Repeat' });
	const day = (name: string) => menu.getByRole('button', { name, exact: true });

	await details.getByRole('button', { name: 'Set repeat' }).click();
	await expect(day('Wed')).toHaveAttribute('aria-pressed', 'false');
	await day('Mon').click();
	await expect(details.getByRole('button', { name: 'Repeats every Mon' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Due Monday' })).toBeVisible();
	await day('Fri').click();
	await expect(menu).toBeVisible();
	await expect(day('Mon')).toHaveAttribute('aria-pressed', 'true');
	await expect(day('Fri')).toHaveAttribute('aria-pressed', 'true');
	await expect(day('Wed')).toHaveAttribute('aria-pressed', 'false');
	await expect(details.getByRole('button', { name: 'Repeats every Mon, Fri' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Due Friday' })).toBeVisible();

	await page.reload();
	await open();
	await expect(details.getByRole('button', { name: 'Due Friday' })).toBeVisible();
	await details.getByRole('button', { name: 'Repeats every Mon, Fri' }).click();
	await day('Mon').click();
	await expect(details.getByRole('button', { name: 'Repeats every Fri' })).toBeVisible();
	await expect(day('Mon')).toHaveAttribute('aria-pressed', 'false');
	await expect(day('Fri')).toBeDisabled();
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
	const interval = menu.getByRole('spinbutton', { name: 'Repeat interval' });
	await interval.fill('');
	await expect(menu.getByRole('button', { name: 'Set' })).toBeDisabled();
	await interval.press('Enter');
	await expect(menu).toBeVisible();
	await expect(details.getByRole('button', { name: 'Repeats every Wed' })).toBeVisible();
	await interval.fill('3');
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
