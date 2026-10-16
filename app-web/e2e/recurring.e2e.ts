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
