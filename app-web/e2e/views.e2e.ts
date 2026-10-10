import { NOW, expect, test } from './fixtures.ts';

const YESTERDAY = new Date(NOW.getTime() - 86_400_000);

test('Inbox, Today, and Upcoming show the right tasks', async ({ app, page }) => {
	await app.setNow(YESTERDAY);
	await page.reload();
	await app.add('Overdue task today');
	await app.setNow(NOW);
	await page.reload();
	await app.add('Today task today', 'Later task in 3 days', 'Someday task');

	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveCount(4);
	await page.screenshot({ path: 'test-results/view-inbox.png' });

	await app.go('Today');
	await expect(page.getByText('Wednesday, October 14')).toBeVisible();
	await expect(app.list('Overdue tasks').getByRole('listitem')).toHaveText([/Overdue task/]);
	await expect(app.row('Overdue task')).toContainText('Yesterday');
	await expect(app.list('Today tasks').getByRole('listitem')).toHaveText([/Today task/]);
	await page.screenshot({ path: 'test-results/view-today.png' });

	await app.go('Upcoming');
	const saturday = page.getByRole('region', { name: 'Oct 17 · Saturday' });
	await expect(saturday.getByRole('listitem')).toHaveText([/Later task/]);
	await expect(app.row('Someday task')).toHaveCount(0);
	await expect(app.row('Today task')).toHaveCount(0);
	await page.screenshot({ path: 'test-results/view-upcoming.png' });

	await app.go('Today');
	await app.row('Today task').getByRole('checkbox').click();
	await app.row('Overdue task').getByRole('checkbox').click();
	await expect(page.getByText('All clear for today')).toBeVisible();
});

test('each view has an empty state', async ({ app, page }) => {
	await expect(page.getByText('Inbox zero')).toBeVisible();
	await app.go('Today');
	await expect(page.getByText('All clear for today')).toBeVisible();
	await app.go('Upcoming');
	await expect(page.getByText('Nothing scheduled')).toBeVisible();
});

test('adding from Today defaults the due date to today', async ({ app, page }) => {
	await app.go('Today');
	await page.getByRole('main').getByRole('button', { name: 'Add task' }).click();
	await expect(app.quickAdd().getByRole('button', { name: 'Due Today' })).toBeVisible();
	await app.taskInput().fill('Stretch');
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await expect(app.list('Today tasks').getByRole('listitem')).toHaveText([/Stretch/]);
});
