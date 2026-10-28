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

test('subtasks are added and checked, and the parent row previews the open ones and shows progress after a reload', async ({
	app,
}) => {
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
	await expect(parent.getByRole('list', { name: 'Open subtasks' }).getByRole('listitem')).toHaveText([
		'〇 Charger',
		'〇 Socks',
	]);

	await app.reload();
	await expect(parent.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
	await parent.getByRole('button', { name: 'Pack for trip', exact: true }).click();
	await expect(subtaskCheckbox(app, 'Passport')).toHaveAttribute('aria-checked', 'true');
	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'false');
});

test('subtask rows show what a list row shows, nest, open in place, and a dated subtask shows in Today under its parent', async ({
	app,
	page,
}) => {
	await app.add('Pack for trip');
	await openWithSubtasks(app, 'Pack for trip', ['Charger', 'Buy adapter today']);
	const adapter = app.details().locator('[data-subtask="Buy adapter"]');
	await expect(adapter.getByText('Today')).toBeVisible();
	await expect(adapter.getByRole('button', { name: 'Postpone Buy adapter' })).toBeAttached();
	await subtaskCheckbox(app, 'Charger').click();
	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

	await app.details().getByRole('button', { name: 'Charger', exact: true }).click();
	const back = app.details().getByRole('button', { name: 'Back to Pack for trip' });
	await expect(back).toBeVisible();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	await app.details().getByRole('textbox', { name: 'Notes' }).fill('The braided one');
	await add.fill('Cable');
	await add.press('Enter');
	await expect(app.details().getByRole('list', { name: 'Subtasks of Charger' }).locator('[data-subtask]')).toHaveText([
		/Cable/,
	]);
	await back.click();

	await expect(subtaskCheckbox(app, 'Charger')).toHaveAttribute('aria-checked', 'false');
	await expect(app.details().locator('[data-subtask="Charger"]').getByText('The braided one')).toBeVisible();
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

test('Add subtask has its own plain text toggle, which goes with the line on Enter and then resets', async ({
	app,
	page,
}) => {
	await app.add('Run errands');
	await app.row('Run errands').getByRole('button', { name: 'Run errands', exact: true }).click();
	const details = app.details();
	const add = details.getByRole('textbox', { name: 'Add subtask' });
	const toggle = details.getByRole('button', { name: 'Plain text subtask' });
	const rows = details.getByRole('list', { name: 'Subtasks of Run errands' }).locator('[data-subtask]');

	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await expect(add).toBeFocused();
	await add.pressSequentially('Call shop at 9am p1 @phone');
	await expect(details.locator('[data-token]')).toHaveCount(0);
	await expect(page.getByRole('listbox')).toHaveCount(0);
	await app.settle();
	await page.screenshot({ path: 'test-results/subtasks/add-subtask-plain-text.png' });
	await add.press('Enter');
	await expect(rows).toHaveCount(1);
	await expect(details.locator('[data-subtask="Call shop at 9am p1 @phone"]')).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');

	await add.pressSequentially('Buy milk friday');
	await expect(details.locator('[data-token]')).toHaveText(['friday']);
	await add.press('Enter');
	await expect(details.locator('[data-subtask="Buy milk"]')).toContainText('Fri');
	expect(await rows.evaluateAll(items => items.map(item => item.getAttribute('data-subtask')))).toEqual([
		'Call shop at 9am p1 @phone',
		'Buy milk',
	]);
});
