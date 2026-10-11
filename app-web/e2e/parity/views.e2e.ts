import { expect, NOW, test, YESTERDAY } from './fixtures.ts';

test('views-inbox: Inbox lists top-level tasks without a project', async ({ app, snap }) => {
	await app.add('Buy milk', 'Pay rent tomorrow', 'Standup today 9am');
	for (const title of ['Buy milk', 'Pay rent', 'Standup']) await expect(app.row(title)).toBeVisible();
	await snap('views-inbox');
});

test('views-today: Today lists what is due today, with overdue in its own section', async ({ app, page, snap }) => {
	await app.relaunch(YESTERDAY);
	await app.add('Overdue task today');
	await app.relaunch(NOW);
	await app.add('Today task today 9am', 'Later task in 3 days');
	await app.go('Today');
	await expect(page.getByText('Wednesday, October 14')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Overdue' })).toBeVisible();
	await expect(app.list('Overdue tasks').getByRole('listitem')).toHaveText([/Overdue task/]);
	await expect(app.row('Overdue task')).toContainText('Yesterday');
	await expect(app.list('Today tasks').getByRole('listitem')).toHaveText([/Today task/]);
	await expect(app.row('Today task')).toContainText('9am');
	await expect(app.row('Later task')).toHaveCount(0);
	await snap('views-today');
});

test('views-upcoming: Upcoming groups later tasks by day', async ({ app, page, snap }) => {
	await app.add('Gym tomorrow', 'Dentist fri 3pm', 'Later task in 3 days', 'Pay rent today', 'Someday task');
	await app.go('Upcoming');
	await expect(page.getByRole('heading', { level: 2 })).toHaveText([
		'Oct 15 · Tomorrow · Thursday',
		'Oct 16 · Friday',
		'Oct 17 · Saturday',
	]);
	await expect(page.getByRole('region', { name: 'Oct 16 · Friday' }).getByRole('listitem')).toHaveText([/Dentist/]);
	await expect(app.row('Dentist')).toContainText('3pm');
	await expect(app.row('Pay rent')).toHaveCount(0);
	await expect(app.row('Someday task')).toHaveCount(0);
	await snap('views-upcoming');
});

test('views-empty: each view has an empty state', async ({ app, page, snap }) => {
	await expect(page.getByText('Inbox zero')).toBeVisible();
	await app.go('Today');
	await expect(page.getByText('All clear for today')).toBeVisible();
	await app.go('Upcoming');
	await expect(page.getByText('Nothing scheduled')).toBeVisible();
	await snap('views-empty');
});

test('views-counts: Inbox and Today show their open counts', async ({ app, page, snap }) => {
	await app.add('Buy milk', 'Pay rent today', 'Standup today 9am', 'Gym tomorrow');
	await page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(app.nav('Inbox')).toContainText('4');
	await expect(app.nav('Today')).toContainText('2');
	await snap('views-counts');
	await app.nav('Inbox').tap();
	await app.checkbox('Pay rent').tap();
	await page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(app.nav('Inbox')).toContainText('3');
	await expect(app.nav('Today')).toContainText('1');
});

test('labels-chips: a task shows its labels as chips', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('@calls');
	await app.quickAdd().getByRole('option', { name: 'Create label “calls”' }).tap();
	await app.type('@errands');
	await app.quickAdd().getByRole('option', { name: 'Create label “errands”' }).tap();
	await app.type('Ping Ana');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await expect(app.row('Ping Ana').locator('[data-label="calls"]')).toBeVisible();
	await expect(app.row('Ping Ana').locator('[data-label="errands"]')).toBeVisible();
	await snap('labels-chips');
});
