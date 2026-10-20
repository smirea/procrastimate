import { expect, test } from './fixtures';

test('quick add parses a date, priority, reminder, #project, and @label and saves each on the task', async ({
	app,
	page,
}) => {
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Call mom tomorrow 5pm p1 #Errands @phone remind me 30m before');
	const quickAdd = app.quickAdd();
	await quickAdd.getByRole('button', { name: 'Create #Errands' }).click();
	await quickAdd.getByRole('button', { name: 'Create @phone' }).click();
	await app.settle();
	expect(
		await quickAdd
			.locator('[data-token]')
			.evaluateAll(tokens => tokens.map(token => [token.getAttribute('data-token'), token.textContent])),
	).toEqual([
		['due', 'tomorrow 5pm'],
		['priority', 'p1'],
		['project', '#Errands'],
		['label', '@phone'],
		['reminder', 'remind me 30m before'],
	]);
	await expect(quickAdd.getByRole('button', { name: 'Due Tomorrow 5pm' })).toBeVisible();
	await expect(quickAdd.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await expect(quickAdd.getByRole('button', { name: 'Project Errands' })).toBeVisible();
	await expect(quickAdd.getByRole('button', { name: 'Labels phone' })).toBeVisible();
	await expect(quickAdd.getByText('30m before', { exact: true })).toBeVisible();

	await app.taskInput().press('Enter');
	await expect(quickAdd).toBeHidden();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await app.go('Errands');
	const row = app.list('Errands tasks').locator('[data-task="Call mom"]');
	await expect(row).toContainText('Tomorrow 5pm');
	await expect(row).toContainText('phone');

	await app.reload();
	await row.getByRole('button', { name: 'Call mom', exact: true }).click();
	const details = app.details();
	await expect(details.getByRole('textbox', { name: 'Title' })).toHaveValue('Call mom');
	await expect(details.getByRole('button', { name: 'Project Errands' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Due Tomorrow 5pm' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Labels phone' })).toBeVisible();
	await details.getByRole('button', { name: '1 reminder' }).click();
	await expect(page.getByRole('dialog', { name: 'Reminders' })).toContainText('30m before');
});
