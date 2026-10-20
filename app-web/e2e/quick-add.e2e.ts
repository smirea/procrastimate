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

test('the mic and the + are one size on one right edge', async ({ app }) => {
	await app.openQuickAdd();
	await app.settle();
	const mic = (await app.quickAdd().getByRole('button', { name: 'Ramble' }).boundingBox())!;
	const plus = (await app.quickAdd().getByRole('button', { name: 'More quick add actions' }).boundingBox())!;
	expect([mic.width, mic.height]).toEqual([plus.width, plus.height]);
	expect(Math.abs(mic.x + mic.width - (plus.x + plus.width))).toBeLessThan(1);
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
	await expect(page.getByRole('list', { name: 'Later tasks' }).locator('[data-task="Paint shed"]')).toBeVisible();

	const sidebarAdd = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add task' });
	await expect(app.quickAdd()).toBeHidden();
	await sidebarAdd.click();
	await expect(app.taskInput()).toBeFocused();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home / Later' })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: 'Labels weekend' })).toBeVisible();
	await app.taskInput().fill('Fix gate');
	await app.taskInput().press('Enter');
	await expect(page.getByRole('list', { name: 'Later tasks' }).locator('[data-task="Fix gate"]')).toBeVisible();
	await expect(app.row('Fix gate')).toContainText('weekend');

	await app.go('Inbox');
	await app.nav('Home').click();
	await sidebarAdd.click();
	await expect(app.taskInput()).toBeFocused();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home', exact: true })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: /^Labels/ })).toBeHidden();
});

test('expanding quick add saves the draft and opens it in task details', async ({ app, page }) => {
	await app.openQuickAdd();
	const expand = app.quickAdd().getByRole('button', { name: 'Open in task details' });
	await expect(expand).toBeDisabled();
	await app.taskInput().fill('Call mom tomorrow p1');
	await app.quickAdd().getByRole('button', { name: 'Add subtask' }).click();
	await app.quickAdd().getByRole('textbox', { name: 'Add subtask' }).fill('Ask about dinner');
	await expand.click();
	await expect(app.quickAdd()).toBeHidden();
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call mom');
	await expect(app.details().getByRole('button', { name: /^Due Tomorrow/ })).toBeVisible();
	await expect(app.details().getByRole('button', { name: /Priority 1/ })).toBeVisible();
	await expect(app.details().getByText('Ask about dinner')).toBeVisible();
	await page.screenshot({ path: 'test-results/quick-add/expanded.png' });
});
