import { expect, NOW, test, type App } from './fixtures';

const tiergarten = {
	name: 'Tiergarten',
	address: 'Berlin',
	latitude: 52.5145,
	longitude: 13.3501,
	radius: 1480,
	trigger: 'during',
};

const standup = {
	id: 'standup',
	title: 'Standup',
	allDay: false,
	series: false,
	edge: 'start',
	minutes: 0,
	occurrences: [
		{ start: NOW.getTime() + 3_600_000, end: NOW.getTime() + 5_400_000, original: NOW.getTime() + 3_600_000 },
	],
};

async function seed(app: App, title: string, fields: Record<string, unknown>) {
	await app.add(title);
	await app.pushFromOtherDevice({ kind: 'task', id: await app.taskId(title), fields });
}

test('quick add on a place screen saves the task at that place', async ({ app, page }) => {
	await seed(app, 'Walk the loop', { location: tiergarten });
	await page.goto('/places/52.5145%2C13.3501');
	await expect(page.getByRole('heading', { level: 1, name: 'Tiergarten' })).toBeVisible();

	await app.openQuickAdd();
	await expect(app.quickAdd().getByText('Tiergarten')).toBeVisible();
	await app.taskInput().fill('Feed the ducks');
	await app.taskInput().press('Enter');

	await expect(page.getByRole('heading', { level: 1, name: 'Tiergarten' })).toBeVisible();
	await expect(app.list('Tasks at Tiergarten').locator('[data-task]')).toHaveCount(2);
	await expect(app.row('Feed the ducks')).toBeVisible();
});

test('removing the place chip saves the task with no place', async ({ app, page }) => {
	await seed(app, 'Walk the loop', { location: tiergarten });
	await page.goto('/places/52.5145%2C13.3501');

	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Remove place' }).click();
	await app.taskInput().fill('Call the bank');
	await app.taskInput().press('Enter');

	await expect(page.getByRole('heading', { level: 1, name: 'No date' })).toBeVisible();
	await expect(app.row('Call the bank')).toBeVisible();
});

test('quick add on an event screen links the task to the event instead of a date', async ({ app, page }) => {
	await seed(app, 'Write the agenda', { event: standup });
	await page.goto('/events/standup');
	await expect(page.getByRole('heading', { level: 1, name: 'Standup' })).toBeVisible();

	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Remove event' })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: /^(Set due date$|Due )/ })).toHaveCount(0);
	await app.taskInput().fill('Share the notes tomorrow');
	await app.taskInput().press('Enter');

	await expect(page.getByRole('heading', { level: 1, name: 'Standup' })).toBeVisible();
	await expect(app.row('Share the notes')).toBeVisible();
	await expect(app.list('Tasks for Standup').locator('[data-task]')).toHaveCount(2);
});

test("an Inbox day's add row adds a task on that day", async ({ app, page }) => {
	await app.add('Pay rent tomorrow');
	await page.getByRole('button', { name: 'Add task to Tomorrow' }).click();
	await app.taskInput().fill('Water the plants');
	await app.taskInput().press('Enter');

	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Tomorrow' }).locator('[data-task="Water the plants"]')).toBeVisible();
});
