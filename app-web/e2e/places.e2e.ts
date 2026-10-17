import { expect, test } from './fixtures';

test('task details show a place with the radius iOS watches', async ({ app }) => {
	await app.add('Walk the loop');
	await app.pushFromOtherDevice({
		kind: 'task',
		id: await app.taskId('Walk the loop'),
		fields: {
			location: {
				name: 'Tiergarten',
				address: 'Berlin',
				latitude: 52.5145,
				longitude: 13.3501,
				radius: 1480,
				trigger: 'during',
			},
		},
	});

	await app.row('Walk the loop').getByRole('button', { name: 'Walk the loop', exact: true }).click();
	await expect(app.details().getByText('While at Tiergarten 1.5 km')).toBeVisible();
});

test('a place saved under a name lists with the labels, and @name or the labels picker puts a task there', async ({
	app,
	page,
}) => {
	await app.add('Water plants');
	await app.pushFromOtherDevice({
		kind: 'task',
		id: await app.taskId('Water plants'),
		fields: {
			location: {
				name: 'Parkweg 1',
				address: 'Berlin',
				latitude: 52.52,
				longitude: 13.405,
				radius: 500,
				trigger: 'arrive',
			},
		},
	});

	await app.nav('Parkweg 1').click();
	await page.getByRole('button', { name: 'Save' }).click();
	await page.getByRole('textbox', { name: 'Place name' }).fill('Home');
	await page.getByRole('button', { name: 'Save place' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(page.getByText('500 m · Berlin')).toBeVisible();
	await expect(app.list('Home tasks').locator('[data-task]')).toHaveText([/Water plants.*Arriving at Home/]);
	const labels = page.getByRole('navigation', { name: 'Main' }).getByRole('region', { name: 'Labels' });
	await expect(labels.getByRole('link', { name: 'Home 1' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('region', { name: 'Places' })).toHaveCount(0);

	await app.add('Sweep the porch');
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(app.list('Home tasks').locator('[data-task]')).toHaveText([
		/Water plants/,
		/Sweep the porch.*Arriving at Home/,
	]);

	await app.go('Inbox');
	await app.openQuickAdd();
	await app.taskInput().fill('Fix the tap @home');
	await expect(app.quickAdd().locator('[data-token="place"]')).toHaveText('@home');
	await app.taskInput().press('Enter');
	await expect(app.quickAdd()).toBeHidden();
	await expect(app.row('Fix the tap')).toContainText('Arriving at Home');

	await app.add('Bring keys');
	await app.row('Bring keys').getByRole('button', { name: 'Bring keys', exact: true }).click();
	await app.details().getByRole('button', { name: 'Add labels' }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Home' }).click();
	await expect(app.details().getByText('Arriving at Home 500 m')).toBeVisible();
	await page.getByRole('menuitemcheckbox', { name: 'Home' }).click();
	await expect(app.details().getByText('Arriving at Home 500 m')).toHaveCount(0);
});
