import { expect, test, type App } from './fixtures.ts';

const suggestions = (app: App) => app.page.getByRole('listbox', { name: 'Labels' });
const chips = (app: App, title: string) => app.row(title).locator('.label-chip');
const labelLink = (app: App, name: string) =>
	app.page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('region', { name: 'Labels' })
		.getByRole('link', { name });

/** Creates each label from the `@` create row, then discards the draft. */
async function createLabels(app: App, ...names: string[]) {
	await app.openQuickAdd();
	for (const name of names) {
		await app.taskInput().pressSequentially(`@${name}`);
		await expect(suggestions(app).getByRole('option')).toHaveText([`Create label “${name}”`]);
		await app.taskInput().press('Enter');
	}
	await app.taskInput().press('Escape');
	await expect(app.quickAdd()).toBeHidden();
}

const settle = (app: App) =>
	app.page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));

test('@ creates and suggests labels, and saved labels show as chips on the row', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Call plumber @calls');
	await expect(suggestions(app).getByRole('option')).toHaveText(['Create label “calls”']);
	await app.taskInput().press('Enter');
	await app.taskInput().pressSequentially('@waiting');
	await app.taskInput().press('Tab');
	await expect(app.taskInput()).toHaveValue('Call plumber @calls @waiting ');
	await expect(app.quickAdd().locator('[data-token="label"]')).toHaveText(['@calls', '@waiting']);
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');

	await app.taskInput().pressSequentially('Email bob@site.com @wa');
	await expect(suggestions(app).getByRole('option')).toHaveText(['waiting', 'Create label “wa”']);
	const listBox = (await suggestions(app).boundingBox())!;
	expect(listBox.y + listBox.height).toBeLessThanOrEqual((await app.taskInput().boundingBox())!.y);
	await settle(app);
	await page.screenshot({ path: 'test-results/label-autocomplete.png' });
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('Email bob@site.com @waiting ');
	await app.taskInput().press('Enter');

	await app.taskInput().pressSequentially('Ping @');
	await expect(suggestions(app).getByRole('option')).toHaveText(['calls', 'waiting']);
	await app.taskInput().press('ArrowDown');
	await expect(suggestions(app).getByRole('option', { name: 'waiting' })).toHaveAttribute('aria-selected', 'true');
	await app.taskInput().press('Escape');
	await expect(suggestions(app)).toBeHidden();
	await expect(app.quickAdd()).toBeVisible();
	await app.taskInput().press('Escape');

	await expect(app.row('Call plumber').getByRole('button', { name: /Call plumber/ })).toContainText('Call plumber');
	await expect(chips(app, 'Call plumber')).toHaveText(['calls', 'waiting']);
	await expect(chips(app, 'Email bob@site.com')).toHaveText(['waiting']);
	await page.screenshot({ path: 'test-results/label-chips.png' });
	await page.reload();
	await expect(chips(app, 'Call plumber')).toHaveText(['calls', 'waiting']);
});

test('keep as text leaves an @label in the title', async ({ app }) => {
	await createLabels(app, 'deep');
	await app.add('Plan @deep');
	await app.openQuickAdd();
	await app.taskInput().fill('Read about @deep learning');
	await expect(app.quickAdd().locator('[data-token="label"]')).toHaveText('@deep');
	await app.quickAdd().getByRole('button', { name: 'Keep as text' }).click();
	await expect(app.quickAdd().locator('[data-token="label"]')).toHaveCount(0);
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await expect(chips(app, 'Read about @deep learning')).toHaveCount(0);
	await expect(chips(app, 'Plan')).toHaveText(['deep']);
});

test('the Labels section opens every task with a label across projects', async ({ app, page }) => {
	await createLabels(app, 'calls');
	await app.createProject('Home');
	await app.add('Fix sink @calls', 'Paint fence');
	await app.go('Inbox');
	await app.add('Call bank @calls');

	await labelLink(app, 'calls').click();
	await expect(page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	const list = app.list('calls tasks');
	await expect(list.getByRole('listitem')).toHaveText([/Fix sink.*Home/, /Call bank.*Inbox/]);
	await expect(labelLink(app, 'calls')).toContainText('2');
	await page.screenshot({ path: 'test-results/label-view.png' });

	await app.add('Call dentist');
	await expect(list.getByRole('listitem')).toHaveText([/Fix sink/, /Call bank/, /Call dentist/]);

	await page.getByRole('button', { name: 'Label actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	const name = page.getByRole('textbox', { name: 'Label name' });
	await name.fill('phone');
	await name.press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'phone' })).toBeVisible();
	await expect(chips(app, 'Call bank')).toHaveText(['phone']);

	await page.getByRole('button', { name: 'Label actions' }).click();
	await page.getByRole('button', { name: 'Delete label' }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Labels' })).toHaveCount(0);
	await expect(app.row('Call bank')).toBeVisible();
	await expect(chips(app, 'Call bank')).toHaveCount(0);
});

test('the details picker toggles and creates labels, and @ works in the title', async ({ app, page }) => {
	await createLabels(app, 'errands');
	await app.add('Buy milk @errands');
	await app
		.row('Buy milk')
		.getByRole('button', { name: /Buy milk/ })
		.click();
	const details = app.details();
	await details.getByRole('button', { name: 'Labels errands' }).click();
	const picker = page.getByRole('dialog', { name: 'Labels' });
	const filter = picker.getByRole('textbox', { name: 'Find or create a label' });
	await expect(filter).toBeFocused();
	await filter.fill('groceries');
	await expect(picker.getByRole('menuitemcheckbox')).toHaveText(['Create label “groceries”']);
	await filter.press('Enter');
	await expect(filter).toHaveValue('');
	await expect(picker.getByRole('menuitemcheckbox', { name: 'groceries' })).toHaveAttribute('aria-checked', 'true');
	await settle(app);
	await page.screenshot({ path: 'test-results/label-picker.png' });
	await picker.getByRole('menuitemcheckbox', { name: 'errands' }).click();
	await expect(picker.getByRole('menuitemcheckbox', { name: 'errands' })).toHaveAttribute('aria-checked', 'false');
	await filter.press('Escape');
	await expect(details.getByRole('button', { name: 'Labels groceries' })).toBeVisible();

	const title = details.getByRole('textbox', { name: 'Title' });
	await title.click();
	await title.press('End');
	await title.pressSequentially(' @err');
	await suggestions(app).getByRole('option', { name: 'errands' }).click();
	await expect(title).toHaveValue('Buy milk @errands ');
	await title.press('Enter');
	await expect(title).toHaveValue('Buy milk');
	await expect(details.getByRole('button', { name: 'Labels groceries, errands' })).toBeVisible();
	await details.getByRole('button', { name: 'Close' }).click();
	await expect(chips(app, 'Buy milk')).toHaveText(['groceries', 'errands']);
});
