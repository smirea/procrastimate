import { App, expect, test } from './fixtures';

async function openWithSubtasks(app: App, parent: string, subtasks: string[]) {
	await app.row(parent).getByRole('button', { name: parent, exact: true }).click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of subtasks) {
		await add.fill(title);
		await add.press('Enter');
	}
	const rows = app
		.details()
		.getByRole('list', { name: `Subtasks of ${parent}` })
		.locator('[data-subtask]');
	await expect(rows).toHaveCount(subtasks.length);
	return rows;
}

const subtaskCheckbox = (app: App, title: string) =>
	app.details().getByRole('checkbox', { name: `Complete ${title}`, exact: true });

async function closeDetails(app: App) {
	await app.page.keyboard.press('Escape');
	await expect(app.details()).toBeHidden();
}

test('subtasks are added, checked, and the parent row shows progress after a reload', async ({ app, page }) => {
	await app.add('Pack for trip');
	const rows = await openWithSubtasks(app, 'Pack for trip', ['Passport', 'Charger', 'Socks']);
	expect(await rows.evaluateAll(items => items.map(item => item.getAttribute('data-subtask')))).toEqual([
		'Passport',
		'Charger',
		'Socks',
	]);

	await subtaskCheckbox(app, 'Passport').click();
	await expect(subtaskCheckbox(app, 'Passport')).toHaveAttribute('aria-checked', 'true');
	await closeDetails(app);

	const parent = app.row('Pack for trip');
	await expect(parent.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
	await expect(parent).toContainText('1/3');
	await expect(app.row('Passport')).toHaveCount(0);

	await app.reload();
	await expect(parent.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
	await parent.getByRole('button', { name: 'Pack for trip', exact: true }).click();
	await expect(subtaskCheckbox(app, 'Passport')).toHaveAttribute('aria-checked', 'true');
	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'false');
});

test('completing a parent completes its subtasks and undo restores each one', async ({ app, page }) => {
	await app.add('Pack for trip');
	await openWithSubtasks(app, 'Pack for trip', ['Passport', 'Charger']);
	await subtaskCheckbox(app, 'Passport').click();
	await expect(subtaskCheckbox(app, 'Passport')).toHaveAttribute('aria-checked', 'true');
	await closeDetails(app);

	await app.row('Pack for trip').getByRole('checkbox', { name: 'Complete Pack for trip' }).click();
	await expect(app.row('Pack for trip')).toHaveCount(0);
	await page.getByRole('button', { name: 'Undo' }).click();

	const parent = app.row('Pack for trip');
	await expect(parent.getByRole('img', { name: '1 of 2 subtasks done' })).toBeVisible();
	await parent.getByRole('button', { name: 'Pack for trip', exact: true }).click();
	await expect(subtaskCheckbox(app, 'Passport')).toHaveAttribute('aria-checked', 'true');
	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'false');
});

test('completing a recurring parent moves it to the next occurrence, resets its subtasks, and undo restores them', async ({
	app,
	page,
}) => {
	await app.add('Weekly review every fri');
	await openWithSubtasks(app, 'Weekly review', ['Inbox zero', 'Plan week']);
	for (const title of ['Inbox zero', 'Plan week']) {
		await subtaskCheckbox(app, title).click();
		await expect(subtaskCheckbox(app, title)).toHaveAttribute('aria-checked', 'true');
	}
	await closeDetails(app);
	const parent = app.row('Weekly review');
	await expect(parent.getByRole('img', { name: '2 of 2 subtasks done' })).toBeVisible();

	await parent.getByRole('checkbox', { name: 'Complete Weekly review' }).click();
	await expect(page.getByText(/Completed “Weekly review”, next due .*Oct 23/)).toBeVisible();
	await expect(parent).toContainText('Oct 23');
	await expect(parent.getByRole('img', { name: '0 of 2 subtasks done' })).toBeVisible();

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(parent).toContainText('Friday');
	await expect(parent.getByRole('img', { name: '2 of 2 subtasks done' })).toBeVisible();
});

test('subtasks nest, open in place, and a dated subtask shows in Today under its parent', async ({ app, page }) => {
	await app.add('Pack for trip');
	await openWithSubtasks(app, 'Pack for trip', ['Charger', 'Buy adapter today']);
	await subtaskCheckbox(app, 'Charger').click();
	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'true');

	await app.details().getByRole('button', { name: 'Charger', exact: true }).click();
	const back = app.details().getByRole('button', { name: 'Back to Pack for trip' });
	await expect(back).toBeVisible();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	await add.fill('Cable');
	await add.press('Enter');
	await expect(app.details().getByRole('list', { name: 'Subtasks of Charger' }).locator('[data-subtask]')).toHaveText([
		/Cable/,
	]);
	await back.click();

	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'false');
	await expect(
		app.details().locator('[data-subtask="Charger"]').getByRole('img', { name: '0 of 1 subtasks done' }),
	).toBeVisible();
	await closeDetails(app);

	await app.go('Inbox');
	const today = page.getByRole('region', { name: 'Today' });
	await expect(today.locator('[data-task="Buy adapter"]')).toContainText('Pack for trip');
	await app.go('No date');
	await expect(page.locator('[data-task]')).toHaveText([/Pack for trip/]);
});

test('a parent row previews its open subtasks in order, and a completed one leaves the preview', async ({ app }) => {
	await app.add('Pack for trip');
	await openWithSubtasks(app, 'Pack for trip', ['Passport', 'Charger', 'Socks']);
	await closeDetails(app);

	const preview = app.row('Pack for trip').getByRole('list', { name: 'Open subtasks' }).getByRole('listitem');
	await expect(preview).toHaveText(['〇 Passport', '〇 Charger', '〇 Socks']);

	await app.row('Pack for trip').getByRole('button', { name: 'Pack for trip', exact: true }).click();
	await subtaskCheckbox(app, 'Charger').click();
	await closeDetails(app);
	await expect(preview).toHaveText(['〇 Passport', '〇 Socks']);
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
});
