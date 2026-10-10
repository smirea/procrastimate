import { expect, test, type App } from './fixtures.ts';

const open = (app: App, title: string) =>
	app
		.row(title)
		.getByRole('button', { name: new RegExp(title) })
		.click();

async function addSubtasks(app: App, ...titles: string[]) {
	const input = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of titles) {
		await input.fill(title);
		await input.press('Enter');
		await expect(input).toHaveValue('');
	}
}

const subtasks = (app: App) =>
	app
		.details()
		.getByRole('list', { name: /^Subtasks of / })
		.getByRole('listitem');

test('subtasks are added, checked, and reordered in task details and the parent row shows progress', async ({
	app,
	page,
}) => {
	await app.add('Pack for trip');
	await open(app, 'Pack for trip');
	await addSubtasks(app, 'Passport', 'Charger', 'Socks');
	await expect(subtasks(app)).toHaveText([/Passport/, /Charger/, /Socks/]);
	await app.details().getByRole('checkbox', { name: 'Complete Passport' }).click();
	await expect(app.details().getByRole('checkbox', { name: 'Complete Passport' })).toBeChecked();
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();

	const handle = app.details().getByRole('button', { name: 'Reorder Socks' });
	const from = (await handle.boundingBox())!;
	const target = (await app.details().locator('[data-subtask="Passport"]').boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
	await page.mouse.up();
	await expect(subtasks(app)).toHaveText([/Socks/, /Passport/, /Charger/]);

	await app.details().getByRole('button', { name: 'Reorder Charger' }).press('ArrowUp');
	await expect(subtasks(app)).toHaveText([/Socks/, /Charger/, /Passport/]);
	await expect(app.details().getByRole('button', { name: 'Reorder Charger' })).toBeFocused();

	await page.reload();
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
	await expect(app.row('Passport')).toHaveCount(0);
	await open(app, 'Pack for trip');
	await expect(subtasks(app)).toHaveText([/Socks/, /Charger/, /Passport/]);
});

test('completing a parent completes its subtasks and undo restores each one', async ({ app, page }) => {
	await app.add('Pack for trip');
	await open(app, 'Pack for trip');
	await addSubtasks(app, 'Passport', 'Charger');
	await app.details().getByRole('checkbox', { name: 'Complete Passport' }).click();
	await app.details().getByRole('button', { name: 'Close' }).click();

	await app.row('Pack for trip').getByRole('checkbox', { name: 'Complete Pack for trip' }).click();
	await expect(app.row('Pack for trip')).toHaveCount(0);
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 2 subtasks done' })).toBeVisible();
	await open(app, 'Pack for trip');
	await expect(app.details().getByRole('checkbox', { name: 'Complete Passport' })).toBeChecked();
	await expect(app.details().getByRole('checkbox', { name: 'Complete Charger' })).not.toBeChecked();
});

test('completing a recurring parent moves it to the next occurrence and resets its subtasks', async ({ app }) => {
	await app.add('Weekly review every fri');
	await open(app, 'Weekly review');
	await addSubtasks(app, 'Inbox zero', 'Plan week');
	await app.details().getByRole('checkbox', { name: 'Complete Inbox zero' }).click();
	await app.details().getByRole('checkbox', { name: 'Complete Plan week' }).click();
	await app.details().getByRole('button', { name: 'Close' }).click();
	await expect(app.row('Weekly review').getByRole('img', { name: '2 of 2 subtasks done' })).toBeVisible();

	await app.row('Weekly review').getByRole('checkbox', { name: 'Complete Weekly review' }).click();
	await expect(app.row('Weekly review')).toContainText('Oct 23');
	await expect(app.row('Weekly review').getByRole('img', { name: '0 of 2 subtasks done' })).toBeVisible();

	await open(app, 'Weekly review');
	await app.details().getByRole('textbox', { name: 'Notes' }).fill('Bring coffee');
	await app.details().getByRole('button', { name: 'Close' }).click();
	await app.page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(app.row('Weekly review')).toContainText('Friday');
	await expect(app.row('Weekly review')).toContainText('Bring coffee');
	await expect(app.row('Weekly review').getByRole('img', { name: '2 of 2 subtasks done' })).toBeVisible();
});

test('a subtask title keeps a project hashtag as text', async ({ app }) => {
	await app.createProject('Home');
	await app.add('Pack for trip');
	await open(app, 'Pack for trip');
	await addSubtasks(app, 'Charger');
	await app
		.details()
		.getByRole('button', { name: /^Charger/ })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.fill('Charger #Home');
	await title.press('Enter');
	await app.details().getByRole('button', { name: 'Back to Pack for trip' }).click();
	await expect(app.details().locator('[data-subtask="Charger #Home"]')).toBeVisible();
});

test('subtasks nest, open in place, and a dated subtask shows in Today under its parent', async ({ app }) => {
	await app.add('Pack for trip');
	await open(app, 'Pack for trip');
	await addSubtasks(app, 'Charger', 'Buy adapter today');
	await app.details().getByRole('checkbox', { name: 'Complete Charger' }).click();
	await app
		.details()
		.getByRole('button', { name: /^Charger/ })
		.click();
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Charger');
	await addSubtasks(app, 'Cable');
	await app.details().getByRole('button', { name: 'Back to Pack for trip' }).click();
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Pack for trip');
	await expect(
		app.details().locator('[data-subtask="Charger"]').getByRole('img', { name: '0 of 1 subtasks done' }),
	).toBeVisible();
	await expect(app.details().getByRole('checkbox', { name: 'Complete Charger' })).not.toBeChecked();
	await app.details().getByRole('button', { name: 'Close' }).click();

	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveText([/Pack for trip/]);
	await app.go('Today');
	await expect(app.row('Buy adapter').getByLabel('Subtask of Pack for trip')).toBeVisible();
});

test('search finds a subtask, shows its parent, and opens it with a way back', async ({ app, page }) => {
	await app.add('Pack for trip');
	await open(app, 'Pack for trip');
	await addSubtasks(app, 'Passport');
	await app.details().getByRole('button', { name: 'Close' }).click();

	await page.keyboard.press('/');
	const search = page.getByRole('dialog', { name: 'Search' });
	await search.getByRole('combobox', { name: 'Search' }).pressSequentially('passport');
	const option = search.getByRole('option');
	await expect(option).toHaveText([/Passport/]);
	await expect(option.getByLabel('Subtask of Pack for trip')).toBeVisible();
	await option.click();
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Passport');
	await expect(app.details().getByRole('button', { name: 'Back to Pack for trip' })).toBeVisible();
});
