import { expect, test } from './fixtures';

test('a project renamed onto another name follows the merge to the older project', async ({ app, page }) => {
	await app.createProject('Home');
	const home = page.url();
	await app.createProject('Errands');

	await page.getByRole('button', { name: 'Project actions' }).click();
	await page.getByRole('button', { name: 'Rename' }).click();
	const name = page.getByRole('textbox', { name: 'Project name' });
	await name.fill('home');
	await name.press('Enter');

	await expect(page).toHaveURL(home);
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(page.getByText('This project no longer exists.')).toHaveCount(0);
});
