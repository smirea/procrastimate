import { expect, test } from './fixtures';

test('task details edit the title, notes, date, priority, and labels, and keep them after a reload', async ({
	app,
	page,
}) => {
	await app.add('Buy milk');
	await app.row('Buy milk').getByRole('button', { name: 'Buy milk', exact: true }).click();
	const details = app.details();
	const title = details.getByRole('textbox', { name: 'Title' });
	await title.fill('Buy oat milk');
	await title.press('Enter');
	await details.getByRole('textbox', { name: 'Notes' }).fill('2 cartons');
	const row = app.row('Buy oat milk');
	await expect(row).toContainText('2 cartons');

	await details.getByRole('button', { name: 'Set due date' }).click();
	await page
		.getByRole('dialog', { name: 'Due date' })
		.getByRole('button', { name: 'Friday, October 16, 2026' })
		.click();
	await page.getByRole('dialog', { name: 'Due date' }).getByRole('button', { name: 'Add time' }).click();
	await page.getByRole('dialog', { name: 'Due date' }).getByRole('button', { name: '6pm', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Due date' })).toBeHidden();
	await expect(details.getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();

	await details.getByRole('button', { name: 'Priority 4' }).click();
	await page.getByRole('dialog', { name: 'Priority' }).getByRole('button', { name: 'Priority 1' }).click();
	await expect(page.getByRole('dialog', { name: 'Priority' })).toBeHidden();
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();

	await details.getByRole('button', { name: 'Add labels' }).click();
	const labels = page.getByRole('dialog', { name: 'Labels' });
	const find = labels.getByRole('textbox', { name: 'Find or create a label' });
	for (const name of ['groceries', 'errands']) {
		await find.fill(name);
		await find.press('Enter');
	}
	await labels.getByRole('menuitemcheckbox', { name: 'groceries' }).click();
	await expect(labels.getByRole('menuitemcheckbox', { name: 'groceries' })).toHaveAttribute('aria-checked', 'false');
	await page.keyboard.press('Escape');
	await expect(details.getByRole('button', { name: 'Labels errands' })).toBeVisible();
	await app.closeDetails();

	await page.reload();
	await app.go('Inbox');
	await expect(row).toContainText('Friday 6pm');
	await expect(row).toContainText('errands');
	await expect(row).not.toContainText('groceries');
	await row.getByRole('button', { name: 'Buy oat milk', exact: true }).click();
	await expect(title).toHaveValue('Buy oat milk');
	await expect(details.getByRole('textbox', { name: 'Notes' })).toHaveValue('2 cartons');
	await expect(details.getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Labels errands' })).toBeVisible();
});

test('Labels in task details opens with focus in its search field', async ({ app, page }) => {
	await app.add('Buy milk');
	await app.row('Buy milk').getByRole('button', { name: 'Buy milk', exact: true }).click();
	await app.details().getByRole('button', { name: 'Add labels' }).click();
	await expect(
		page.getByRole('dialog', { name: 'Labels' }).getByRole('textbox', { name: 'Find or create a label' }),
	).toBeFocused();
});
