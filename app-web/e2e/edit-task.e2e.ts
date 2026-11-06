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
	await expect(find).toBeFocused();
	for (const name of ['groceries', 'errands']) {
		await find.fill(name);
		await find.press('Enter');
	}
	await labels.getByRole('menuitemcheckbox', { name: 'groceries' }).click();
	await expect(labels.getByRole('menuitemcheckbox', { name: 'groceries' })).toHaveAttribute('aria-checked', 'false');
	await page.keyboard.press('Escape');
	await expect(details.getByRole('button', { name: 'Labels errands' })).toBeFocused();
	await app.closeDetails();

	await app.reload();
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

	// Notes save once typing pauses, and a reload before the pause still keeps what was typed.
	await details.getByRole('textbox', { name: 'Notes' }).pressSequentially(', oat');
	await app.reload();
	await row.getByRole('button', { name: 'Buy oat milk', exact: true }).click();
	await expect(details.getByRole('textbox', { name: 'Notes' })).toHaveValue('2 cartons, oat');
});

test('a rename from another device reaches an open, untouched title field, and closing writes nothing back', async ({
	app,
}) => {
	await app.add('Buy milk');
	const id = await app.taskId('Buy milk');
	await app.row('Buy milk').getByRole('button', { name: 'Buy milk', exact: true }).click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.focus();
	await app.pushFromOtherDevice({ kind: 'task', id, fields: { title: 'Buy oat milk' } });
	await expect(title).toHaveValue('Buy oat milk');
	await title.press('Enter');
	await app.closeDetails();
	await expect.poll(() => app.pending()).toBe(0);
	await expect
		.poll(() => app.page.evaluate(id => window.procrastimate.entity('task', id), id))
		.toMatchObject({ title: 'Buy oat milk' });
});

test('a phrase left in a saved title stays text until the title is edited, so the highlight matches the chips', async ({
	app,
}) => {
	await app.add('Sign out of prime');
	const id = await app.taskId('Sign out of prime');
	await app.pushFromOtherDevice({ kind: 'task', id, fields: { title: 'Sign out of prime nov 7' } });
	await app
		.row('Sign out of prime nov 7')
		.getByRole('button', { name: 'Sign out of prime nov 7', exact: true })
		.click();
	const details = app.details();
	const title = details.getByRole('textbox', { name: 'Title' });
	await expect(title).toHaveValue('Sign out of prime nov 7');
	await expect(details.locator('[data-token]')).toHaveCount(0);
	await expect(details.getByRole('button', { name: 'Set due date' })).toBeVisible();

	await title.press('End');
	await title.pressSequentially(' p1');
	await expect(details.locator('[data-token]')).toHaveText(['nov 7', 'p1']);
	await expect(details.getByRole('button', { name: /^Due / })).toBeVisible();
	await title.press('Enter');
	await expect(title).toHaveValue('Sign out of prime');
	await expect(details.getByRole('button', { name: /^Due / })).toBeVisible();
});

test('a plain text title stays literal in details, and its Plain text chip turns parsing back on', async ({
	app,
	page,
}) => {
	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Plain text' }).click();
	await app.taskInput().pressSequentially('Standup notse 9am tomorrow p1');
	await app.taskInput().press('Enter');
	await app.closeQuickAdd();
	await app.go('No date');
	await app
		.row('Standup notse 9am tomorrow p1')
		.getByRole('button', { name: 'Standup notse 9am tomorrow p1', exact: true })
		.click();
	const details = app.details();
	const plain = details.getByRole('button', { name: 'Plain text', exact: true });
	await expect(plain).toHaveAttribute('aria-pressed', 'true');
	const title = details.getByRole('textbox', { name: 'Title' });
	await title.fill('Standup notes 9am tomorrow p1');
	await expect(details.locator('[data-token]')).toHaveCount(0);
	await expect(details.getByRole('button', { name: 'Set due date' })).toBeVisible();
	await app.settle();
	await page.screenshot({ path: 'test-results/edit-task/literal-title.png' });
	await title.press('Enter');
	await expect(title).toHaveValue('Standup notes 9am tomorrow p1');
	await expect(details.getByRole('button', { name: 'Set due date' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Priority 4' })).toBeVisible();

	await title.focus();
	await plain.click();
	await expect(plain).toHaveAttribute('aria-pressed', 'false');
	await expect(title).toBeFocused();
	await expect(details.locator('[data-token]')).toHaveCount(0);
	await title.press('End');
	await title.pressSequentially(' ');
	await expect(details.locator('[data-token]')).toHaveText(['9am tomorrow', 'p1']);
	await app.settle();
	await page.screenshot({ path: 'test-results/edit-task/parse-title.png' });
	await title.press('Enter');
	await expect(title).toHaveValue('Standup notes');
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await expect(details.getByRole('button', { name: /^Due Tomorrow 9am/ })).toBeVisible();
});
