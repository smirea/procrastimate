import { expect, test, type PhoneApp } from './fixtures.ts';

async function openNav(app: PhoneApp) {
	await app.page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(app.page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function createLabels(app: PhoneApp, ...names: string[]) {
	await app.openQuickAdd();
	for (const name of names) {
		await app.type(`@${name}`);
		await app
			.quickAdd()
			.getByRole('option', { name: `Create label “${name}”` })
			.tap();
	}
	await app.cancelQuickAdd();
}

async function openLabel(app: PhoneApp, name: string) {
	await openNav(app);
	await app.nav(name).tap();
	await expect(app.page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function rename(app: PhoneApp, name: string) {
	await app.page.getByRole('button', { name: 'Label actions' }).tap();
	await app.page.getByRole('button', { name: 'Rename' }).tap();
	const field = app.page.getByRole('textbox', { name: 'Label name' });
	await field.fill(name);
	await field.press('Enter');
}

/** `calls` on `Fix sink` in `Home` and on `Call bank` in Inbox. */
async function seedCalls(app: PhoneApp) {
	await openNav(app);
	await app.page.getByRole('button', { name: 'Add project' }).tap();
	await app.page.getByRole('textbox', { name: 'Project name' }).fill('Home');
	await app.page.getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect(app.page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await app.openQuickAdd();
	await app.type('@calls');
	await app.quickAdd().getByRole('option', { name: 'Create label “calls”' }).tap();
	await app.type('Fix sink');
	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await app.cancelQuickAdd();
	await app.go('Inbox');
	await app.add('@calls Call bank');
}

test('labels-view: a label lists its open tasks across projects, each naming its project', async ({ app, snap }) => {
	await seedCalls(app);
	await openNav(app);
	await expect(app.nav('calls')).toContainText('2');
	await app.nav('calls').tap();
	await expect(app.page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	await expect(app.list('calls tasks').getByRole('listitem')).toHaveText([/Fix sink.*Home/, /Call bank.*Inbox/]);
	await snap('labels-view');
	await app.openQuickAdd();
	await expect(app.quickAdd().getByText('calls', { exact: true })).toBeVisible();
	await app.taskInput().fill('Call dentist');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Call dentist').locator('[data-label="calls"]')).toBeVisible();
});

test('labels-rename: a label renames, but never onto another label ignoring case', async ({ app, page, snap }) => {
	await createLabels(app, 'calls', 'Errands');
	await app.add('@calls Call bank');
	await openLabel(app, 'calls');
	await rename(app, 'errands');
	await expect(page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	await rename(app, 'phone');
	await expect(page.getByRole('heading', { level: 1, name: 'phone' })).toBeVisible();
	await expect(app.row('Call bank').locator('[data-label="phone"]')).toBeVisible();
	await snap('labels-rename');
});

test('labels-delete: deleting a label keeps its tasks', async ({ app, page, snap }) => {
	await createLabels(app, 'phone');
	await app.add('@phone Call bank');
	await openLabel(app, 'phone');
	await page.getByRole('button', { name: 'Label actions' }).tap();
	await page.getByRole('button', { name: 'Delete label' }).tap();
	await expect(page.getByText('Delete phone? Its tasks stay, without the label.')).toBeVisible();
	await snap('labels-delete');
	await page.getByRole('button', { name: 'Delete', exact: true }).tap();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(app.row('Call bank')).toBeVisible();
	await expect(app.row('Call bank').locator('[data-label]')).toHaveCount(0);
	await openNav(app);
	await expect(app.nav('phone')).toHaveCount(0);
});
