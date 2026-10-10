import { expect, test } from './fixtures.ts';

test('create, assign with #, move, rename, and delete a project', async ({ app, page }) => {
	await app.createProject('Home');
	await expect(page.getByText('No tasks yet')).toBeVisible();

	await app.add('Fix sink #home', 'Paint fence');
	const home = app.list('Home tasks').getByRole('listitem');
	await expect(home).toHaveText([/Fix sink/, /Paint fence/]);
	await page.screenshot({ path: 'test-results/view-project.png' });

	await app.go('Inbox');
	await app.add('Buy milk');
	await app
		.row('Buy milk')
		.getByRole('button', { name: /Buy milk/ })
		.click();
	await app.details().getByRole('button', { name: 'Project Inbox' }).click();
	await page.getByRole('dialog', { name: 'Project' }).getByRole('button', { name: 'Home' }).click();
	await app.details().getByRole('button', { name: 'Close' }).click();
	await expect(app.row('Buy milk')).toHaveCount(0);

	await app.nav('Home').click();
	await expect(home).toHaveCount(3);

	await page.getByRole('button', { name: 'Project actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	const name = page.getByRole('textbox', { name: 'Project name' });
	await name.fill('House');
	await name.press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'House' })).toBeVisible();
	await expect(app.nav('House')).toBeVisible();

	await page.getByRole('button', { name: 'Project actions' }).click();
	await page.getByRole('button', { name: 'Delete project' }).click();
	await expect(page.getByText('Delete House and its 3 tasks?')).toBeVisible();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(app.nav('House')).toHaveCount(0);
	await expect(app.row('Buy milk')).toHaveCount(0);
});

test('quick add inside a project defaults to that project', async ({ app }) => {
	await app.createProject('Errands');
	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Project Errands' })).toBeVisible();
	await app.taskInput().fill('Post office');
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await expect(app.list('Errands tasks').getByRole('listitem')).toHaveText([/Post office/]);
});
