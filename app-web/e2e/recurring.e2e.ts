import { expect, test } from './fixtures';

test('the repeat menu offers the due date’s weekday of the month', async ({ app, page }) => {
	await app.setNow(new Date('2026-10-14T10:00:00Z'));
	await app.reload();
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
	await expect(row).toContainText('Friday 9am');
	await expect(page.getByRole('checkbox', { name: 'Complete Standup' })).toHaveAttribute('aria-checked', 'false');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(row).toContainText('Tomorrow 9am');

	await checkbox.click();
	await expect(row).toContainText('Friday 9am');
	await page.addInitScript(() => {
		const shown: string[] = [];
		Object.assign(window, { shownNotifications: shown });
		// Without push the open app shows the system notification itself.
		delete (window as { PushManager?: unknown }).PushManager;
		window.Notification = class {
			static permission = 'granted';
			static requestPermission = async () => 'granted';
			onclick = null;
			constructor(title: string, options?: NotificationOptions) {
				shown.push(`${title}: ${options?.body}`);
			}
		} as unknown as typeof Notification;
	});
	await app.setNow(new Date('2026-10-16T08:51:00Z'));
	await app.reload();
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { shownNotifications: string[] }).shownNotifications))
		.toEqual(['Standup: Today 9:00 AM']);
	await expect(page.getByRole('region', { name: 'Today' }).locator('[data-task="Standup"]')).toContainText('9am');
});
