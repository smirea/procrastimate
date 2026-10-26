import { expect, test } from './fixtures';

test('Tomorrow and This week list their days, and quick add there lands on them', async ({ app, page }) => {
	await app.add('Water plants today', 'Call mom tomorrow', 'Pay rent sat', 'Dentist mon');

	await app.openNavigation();
	await app.go('Tomorrow');
	await expect(page.locator('[data-task]')).toHaveCount(1);
	await expect(app.row('Call mom')).toBeVisible();

	await app.openQuickAdd();
	await expect(app.quickAdd().getByText('Tomorrow')).toBeVisible();
	await app.taskInput().fill('Buy flowers');
	await app.taskInput().press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'Tomorrow' })).toBeVisible();
	await expect(app.row('Buy flowers')).toBeVisible();

	await app.openNavigation();
	await app.go('This week');
	const tasksIn = (day: string) => page.getByRole('region', { name: day }).locator('[data-task]');
	await expect(tasksIn('Today')).toHaveAttribute('data-task', 'Water plants');
	await expect(tasksIn('Tomorrow')).toHaveCount(2);
	await expect(tasksIn('Saturday')).toHaveAttribute('data-task', 'Pay rent');
	await expect(app.row('Dentist')).toHaveCount(0);
	await page.screenshot({ path: 'test-results/lists/this-week.png' });

	const saturday = page.getByRole('region', { name: 'Saturday' });
	await expect(saturday.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);
	await saturday.getByRole('button', { name: 'Add task to Saturday' }).click();
	await app.taskInput().fill('Bake bread');
	await app.taskInput().press('Enter');
	await expect(app.quickAdd()).toBeHidden();
	await expect(tasksIn('Saturday')).toHaveCount(2);

	await app.openNavigation();
	await app.go('Inbox');
	await expect(app.row('Dentist')).toBeVisible();
});
