import { expect, test, type App } from './fixtures';

const tiergarten = {
	name: 'Tiergarten',
	address: 'Berlin',
	latitude: 52.5145,
	longitude: 13.3501,
	radius: 1480,
	trigger: 'during',
};

async function seed(app: App, title: string, fields: Record<string, unknown>) {
	await app.add(title);
	await app.pushFromOtherDevice({ kind: 'task', id: await app.taskId(title), fields });
}

test('removing the place chip saves the task with no place', async ({ app, page }) => {
	await seed(app, 'Walk the loop', { location: tiergarten });
	await page.goto('/places/52.5145%2C13.3501');

	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Remove place' }).click();
	await app.taskInput().fill('Call the bank');
	await app.taskInput().press('Enter');
	await expect(page.getByRole('status').filter({ hasText: 'Added to No date' })).toBeVisible();
	await app.showAdded();

	await expect(page.getByRole('heading', { level: 1, name: 'No date' })).toBeVisible();
	await expect(app.row('Call the bank')).toBeVisible();
});
