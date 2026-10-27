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
	await expect(app.taskInput()).toHaveValue('');
	await app.closeQuickAdd();
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

test('quick add stays open after a save, flashes a row the list shows, and names any other list it went to', async ({
	app,
	page,
}) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Pay rent tomorrow');
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await expect(app.taskInput()).toBeFocused();
	await expect(app.quickAdd().getByRole('button', { name: 'Due Tomorrow' })).toBeHidden();
	await expect(app.row('Pay rent')).toBeAttached();
	await expect(page.getByText(/^Added to/)).toBeHidden();

	await app.taskInput().fill('Buy milk');
	await app.quickAdd().getByRole('button', { name: 'Add task' }).click();
	await expect(app.taskInput()).toHaveValue('');
	await expect(app.taskInput()).toBeFocused();
	await expect(page.getByText('Added to No date')).toBeVisible();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await app.settle();
	await page.screenshot({ path: 'test-results/quick-add/stay-open.png' });

	await app.taskInput().fill('Water plants');
	await app.taskInput().press('Enter');
	await expect(page.getByText('Added to No date')).toHaveCount(1);
	await page.getByRole('button', { name: 'Show' }).click();
	await expect(app.quickAdd()).toBeHidden();
	await expect(page.getByRole('heading', { level: 1, name: 'No date' })).toBeVisible();
	await expect(app.row('Buy milk')).toBeVisible();
	await expect(app.row('Water plants')).toBeVisible();
});

test('quick add reuses the last task’s project, section, and labels while the list it saved from stays open', async ({
	app,
	page,
}) => {
	await app.addCreating('Mow @weekend lawn');
	await app.createProject('Home');
	await page.getByRole('button', { name: 'Add section' }).click();
	await page.getByRole('textbox', { name: 'New section name' }).fill('Later');
	await page.getByRole('textbox', { name: 'New section name' }).press('Enter');
	await app.openQuickAdd();
	await app.taskInput().fill('Paint shed /Later @weekend');
	await app.quickAdd().getByRole('button', { name: 'Add task' }).click();
	await expect(page.getByRole('list', { name: 'Later tasks' }).locator('[data-task="Paint shed"]')).toBeAttached();

	await expect(app.taskInput()).toHaveValue('');
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home / Later' })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: 'Labels weekend' })).toBeVisible();
	await app.taskInput().fill('Fix gate');
	await app.taskInput().press('Enter');
	await app.closeQuickAdd();
	await expect(page.getByRole('list', { name: 'Later tasks' }).locator('[data-task="Fix gate"]')).toBeVisible();
	await expect(app.row('Fix gate')).toContainText('weekend');

	const sidebarAdd = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add task' });
	await sidebarAdd.click();
	await expect(app.taskInput()).toBeFocused();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home / Later' })).toBeVisible();
	await app.closeQuickAdd();

	await app.go('Inbox');
	await app.nav('Home').click();
	await sidebarAdd.click();
	await expect(app.taskInput()).toBeFocused();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home', exact: true })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: /^Labels/ })).toBeHidden();
});

test('quick add suggests the project and label of similar past tasks, never the section, and a tap sets each', async ({
	app,
	page,
}) => {
	await app.addCreating('Mow @weekend lawn');
	await app.createProject('Home');
	await page.getByRole('button', { name: 'Add section' }).click();
	await page.getByRole('textbox', { name: 'New section name' }).fill('Garden');
	await page.getByRole('textbox', { name: 'New section name' }).press('Enter');
	await app.add('Water the plants /Garden @weekend', 'Water the lawn /Garden @weekend');

	await app.go('Inbox');
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('water the roses');
	const suggestions = app.quickAdd().getByRole('group', { name: 'Suggestions' });
	await expect(suggestions.getByRole('button')).toHaveText(['Home', 'weekend']);

	await suggestions.getByRole('button', { name: 'Suggest Home as project' }).click();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home', exact: true })).toBeVisible();
	await expect(suggestions.getByRole('button')).toHaveText(['weekend']);
	await expect(app.taskInput()).toBeFocused();

	await suggestions.getByRole('button', { name: 'Suggest weekend as label' }).click();
	await expect(app.quickAdd().getByRole('button', { name: 'Labels weekend' })).toBeVisible();
	await expect(suggestions).toBeHidden();
	await expect(app.taskInput()).toHaveValue('water the roses');

	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await app.taskInput().pressSequentially('water the tulips');
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home', exact: true })).toBeVisible();
	await expect(suggestions).toBeHidden();

	await page.getByRole('button', { name: 'Show' }).click();
	await expect(app.row('water the roses')).toContainText('weekend');
});
