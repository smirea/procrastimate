import { expect, test, type PhoneApp } from './fixtures.ts';

const nav = (app: PhoneApp) => app.page.getByRole('navigation', { name: 'Main' });

async function openNav(app: PhoneApp) {
	await app.page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(nav(app)).toBeVisible();
}

/** `Add project` in the drawer, then Enter, which opens the new project. */
async function createProject(app: PhoneApp, name: string) {
	await openNav(app);
	await app.page.getByRole('button', { name: 'Add project' }).tap();
	await app.page.getByRole('textbox', { name: 'Project name' }).fill(name);
	await app.page.getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect(app.page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function addInPlace(app: PhoneApp, ...titles: string[]) {
	await app.openQuickAdd();
	for (const title of titles) {
		await app.taskInput().fill(title);
		await app.taskInput().press('Enter');
		await expect(app.taskInput()).toHaveValue('');
	}
	await app.cancelQuickAdd();
}

test('projects-create: Add project creates a project and opens it', async ({ app, page, snap }) => {
	await createProject(app, 'Home');
	await expect(page.getByText('No tasks yet')).toBeVisible();
	await expect(page.getByText('Add one here, or type #Home in quick add.')).toBeVisible();
	await snap('projects-create');
	await openNav(app);
	await expect(app.nav('Home')).toBeVisible();
});

test('projects-open: a project lists its tasks, and quick add there files into it', async ({ app, page, snap }) => {
	await createProject(app, 'Home');
	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Home' })).toBeVisible();
	await app.cancelQuickAdd();
	await addInPlace(app, 'Fix sink p3', 'Paint fence fri');
	await expect(app.list('Home tasks').getByRole('listitem')).toHaveText([/Paint fence/, /Fix sink/]);
	await openNav(app);
	await expect(app.nav('Home')).toContainText('2');
	await snap('projects-open');
	await app.nav('Inbox').tap();
	await expect(page.getByText('Inbox zero')).toBeVisible();
	await openNav(app);
	await app.nav('Home').tap();
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(app.row('Fix sink')).toBeVisible();
});

test('projects-rename: Project actions renames the project', async ({ app, page, snap }) => {
	await createProject(app, 'Home');
	await page.getByRole('button', { name: 'Project actions' }).tap();
	await page.getByRole('button', { name: 'Rename' }).tap();
	const name = page.getByRole('textbox', { name: 'Project name' });
	await name.fill('House');
	await name.press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'House' })).toBeVisible();
	await snap('projects-rename');
	await openNav(app);
	await expect(app.nav('House')).toBeVisible();
	await expect(app.nav('Home')).toHaveCount(0);
});

test('projects-delete: deleting confirms with the task count and removes the tasks', async ({ app, page, snap }) => {
	await createProject(app, 'House');
	await addInPlace(app, 'Buy milk', 'Fix sink', 'Paint fence');
	await page.getByRole('button', { name: 'Project actions' }).tap();
	await page.getByRole('button', { name: 'Delete project' }).tap();
	await expect(page.getByText('Delete House and its 3 tasks?')).toBeVisible();
	await snap('projects-delete');
	await page.getByRole('button', { name: 'Delete', exact: true }).tap();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await openNav(app);
	await expect(app.nav('House')).toHaveCount(0);
	await nav(app).getByRole('button', { name: 'Search' }).tap();
	await page.getByRole('combobox', { name: 'Search' }).fill('milk');
	await expect(page.getByRole('listbox', { name: 'Search results' })).toHaveText('No results for “milk”');
});
