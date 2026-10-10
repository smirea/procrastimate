import { expect, test } from './fixtures.ts';

test('completing animates the task out and undo restores it', async ({ app, page }) => {
	await app.add('Buy milk', 'Pay rent');
	await app.row('Buy milk').getByRole('checkbox', { name: 'Complete Buy milk' }).click();
	await expect(app.row('Buy milk')).toHaveCount(0);
	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveText([/Pay rent/]);
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveText([/Buy milk/, /Pay rent/]);
});

test('details edit fields as they change and persist across reload', async ({ app, page }) => {
	await app.add('Buy milk');
	await app
		.row('Buy milk')
		.getByRole('button', { name: /Buy milk/ })
		.click();
	const details = app.details();
	await expect(details.getByRole('textbox', { name: 'Title' })).toHaveValue('Buy milk');

	await details.getByRole('textbox', { name: 'Title' }).fill('Buy oat milk');
	await details.getByRole('textbox', { name: 'Title' }).press('Enter');
	await details.getByRole('textbox', { name: 'Notes' }).fill('2 cartons');
	await details.getByRole('button', { name: 'Set due date' }).click();
	await page.getByRole('dialog', { name: 'Due date' }).getByRole('button', { name: 'Today' }).click();
	await details.getByRole('button', { name: 'Priority 4' }).click();
	await page.getByRole('dialog', { name: 'Priority' }).getByRole('button', { name: 'Priority 1' }).click();
	await expect(app.row('Buy oat milk')).toContainText('2 cartons');

	await page.reload();
	await app
		.row('Buy oat milk')
		.getByRole('button', { name: /Buy oat milk/ })
		.click();
	await expect(details.getByRole('textbox', { name: 'Notes' })).toHaveValue('2 cartons');
	await expect(details.getByRole('button', { name: 'Due Today' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await details.getByRole('button', { name: 'Close' }).click();
	await app.go('Today');
	await expect(app.row('Buy oat milk')).toBeVisible();
});

test('natural language in the details title updates the fields', async ({ app }) => {
	await app.add('Water plants');
	await app
		.row('Water plants')
		.getByRole('button', { name: /Water plants/ })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.fill('Water plants fri 6pm !! remind me 1h before');
	await expect(app.details().locator('[data-token="priority"]')).toHaveText('!!');
	await title.press('Enter');
	await expect(title).toHaveValue('Water plants');
	await expect(app.details().getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
	await expect(app.details().getByRole('button', { name: 'Priority 2' })).toBeVisible();
	await expect(app.details().getByRole('button', { name: '1 reminder' })).toBeVisible();
});

test('delete removes the task and undo brings it back', async ({ app, page }) => {
	await app.add('Buy milk');
	await app
		.row('Buy milk')
		.getByRole('button', { name: /Buy milk/ })
		.click();
	await app.details().getByRole('button', { name: 'Delete task' }).click();
	await expect(app.row('Buy milk')).toHaveCount(0);
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(app.row('Buy milk')).toBeVisible();
});
