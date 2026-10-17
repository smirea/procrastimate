import { expect, test } from './fixtures';

test('a label view lists its tasks across projects, and the label renames and deletes while its tasks stay, and undo puts it back on them', async ({
	app,
	page,
}) => {
	await app.addCreating('#Home @calls Fix sink');
	await app.go('Inbox');
	await app.add('@calls Call bank');
	await app.addCreating('@Errands Buy stamps');

	await app.nav('calls').click();
	await expect(page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	const list = app.list('calls tasks');
	await expect(list.locator('[data-task]')).toHaveText([/Fix sink.*Home/, /Call bank/]);

	const rename = async (name: string) => {
		await page.getByRole('button', { name: 'Label actions' }).click();
		await page.getByRole('button', { name: 'Rename' }).click();
		const input = page.getByRole('textbox', { name: 'Label name' });
		await input.fill(name);
		await input.press('Enter');
		await expect(input).toBeHidden();
	};
	await rename('errands');
	await expect(page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	await rename('phone');
	await expect(page.getByRole('heading', { level: 1, name: 'phone' })).toBeVisible();
	await expect(list).toHaveCount(0);
	await expect(app.list('phone tasks').locator('[data-task]')).toHaveText([/Fix sink.*phone/, /Call bank.*phone/]);

	await page.getByRole('button', { name: 'Label actions' }).click();
	await page.getByRole('button', { name: 'Delete label' }).click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(app.nav('phone')).toHaveCount(0);
	await app.go('No date');
	await expect(app.row('Call bank')).toBeVisible();
	await expect(app.row('Call bank')).not.toContainText('phone');

	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect(app.row('Call bank')).toContainText('phone');
	await app.nav('phone').click();
	await expect(app.list('phone tasks').locator('[data-task]')).toHaveText([/Fix sink.*phone/, /Call bank.*phone/]);
});

test('a label view names Inbox on an Inbox task that has no date', async ({ app }) => {
	await app.addCreating('@calls Call bank');
	await app.nav('calls').click();
	await expect(app.list('calls tasks').locator('[data-task="Call bank"]')).toContainText('Inbox');
});
