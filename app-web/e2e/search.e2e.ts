import { expect, test } from './fixtures';

test('search matches titles, notes, projects, and labels, needs every word, has the row menu, and opens what Enter picks', async ({
	app,
	page,
}) => {
	await app.addCreating('#Home Fix sink p2');
	await app.go('Inbox');
	await app.addCreating('@calls Plumber');
	await app.addCreating('@waiting @calls Dentist');
	await app.go('Inbox');
	await app.add('Call bank');
	await app.row('Call bank').getByRole('button', { name: 'Call bank', exact: true }).click();
	await app.details().getByRole('textbox', { name: 'Notes' }).fill('Ask about the home loan');
	await app.closeDetails();

	const search = page.getByRole('dialog', { name: 'Search' });
	const field = search.getByRole('combobox', { name: 'Search' });
	const results = search.getByRole('listbox', { name: 'Search results' });
	await page.keyboard.press('/');
	await expect(field).toBeFocused();
	await field.fill('home');
	await expect(results.getByRole('group')).toHaveText([/^Projects/, /^Tasks/]);
	await expect(results.getByRole('option')).toHaveText([/^\s*Home$/, /Fix sink/, /Call bank Ask about the home loan/]);
	await expect(results.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
	await expect(results.locator('mark')).toHaveText(['Home', 'Home', 'home']);

	await field.fill('sink garden');
	await expect(search).toContainText('No results for “sink garden”');

	await field.fill('sink');
	await expect(results.getByRole('option')).toHaveText([/Fix sink/]);
	const menu = page.getByRole('menu', { name: 'Fix sink' });
	await field.press('Shift+F10');
	await expect(menu.getByRole('menuitem').first()).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(search).toBeVisible();
	await expect(field).toBeFocused();
	await results.getByRole('option', { name: /Fix sink/ }).click({ button: 'right' });
	await app.settle();
	await page.screenshot({ path: 'test-results/row-menu/search-menu.png' });
	await menu.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(results.getByRole('option')).toHaveCount(0);
	await expect(page.getByRole('status').filter({ hasText: 'Deleted “Fix sink”' })).toBeVisible();
	await expect(search).toBeVisible();

	await field.fill('wait');
	await field.press('Enter');
	await expect(search).toBeHidden();
	await expect(page.getByRole('heading', { level: 1, name: 'waiting' })).toBeVisible();
	await expect(page.getByRole('main').locator('[data-task]')).toHaveText([/Dentist/]);

	await page.keyboard.press('/');
	await expect(field).toBeFocused();
	await expect(field).toHaveValue('');
	await field.fill('bank');
	await field.press('Enter');
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call bank');
});
