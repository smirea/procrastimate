import { expect, test } from './fixtures';

const navNames = async (app: { page: import('@playwright/test').Page }) =>
	(await app.page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()).map(text =>
		text.replace(/\s*\d+$/, '').trim(),
	);

test('the sidebar keeps every fixed list, empty ones included, so it never shifts', async ({ app, page }) => {
	await app.openNavigation();
	expect((await navNames(app)).slice(0, 5)).toEqual(['Inbox', 'Tomorrow', 'This week', 'No date', 'Completed']);

	await app.add('Someday task');
	await app.go('No date');
	await app.row('Someday task').getByRole('checkbox', { name: 'Complete Someday task' }).click();
	await expect(page.getByText('Inbox zero')).toBeVisible();

	await app.openNavigation();
	await app.go('Inbox');
	await app.openNavigation();
	await expect(app.nav('No date')).toBeVisible();
	await expect(app.nav('Tomorrow')).toBeVisible();
	await page.screenshot({ path: 'test-results/lists/sidebar.png' });
});

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

	await app.openNavigation();
	await app.go('Inbox');
	await expect(app.row('Dentist')).toBeVisible();
});
