import { expect, test } from './fixtures';

test('a subtask row in task details shows what a list row shows and toggles in place', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Pack for trip @home');
	await page.getByRole('option', { name: 'Create label “home”' }).click();
	await app.taskInput().press('Enter');
	await expect(app.quickAdd()).toBeHidden();
	await app.row('Pack for trip').getByRole('button', { name: 'Pack for trip', exact: true }).click();

	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	await add.fill('Passport @home tomorrow');
	await add.press('Enter');
	await add.fill('Socks');
	await add.press('Enter');

	const subtasks = app.details().getByRole('list', { name: 'Subtasks of Pack for trip' });
	const passport = subtasks.locator('[data-subtask="Passport"]');
	await expect(passport.getByText('home', { exact: true })).toBeVisible();
	await expect(passport.getByText('Tomorrow')).toBeVisible();
	await expect(passport.getByRole('button', { name: 'Postpone Passport' })).toBeAttached();

	await passport.getByRole('button', { name: 'Passport', exact: true }).click();
	await app.details().getByRole('textbox', { name: 'Notes' }).fill('The renewed one');
	await app.details().getByRole('button', { name: 'Back to Pack for trip' }).click();
	await expect(passport.getByText('The renewed one')).toBeVisible();

	await passport.getByRole('checkbox', { name: 'Complete Passport' }).click();
	await expect(passport.getByRole('checkbox', { name: 'Complete Passport' })).toHaveAttribute('aria-checked', 'true');
	await expect(passport.getByText('Tomorrow')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
	await expect(subtasks.locator('[data-subtask]')).toHaveCount(2);

	await passport.getByRole('checkbox', { name: 'Complete Passport' }).click();
	await expect(passport.getByRole('checkbox', { name: 'Complete Passport' })).toHaveAttribute('aria-checked', 'false');
});

test('No date leaves the sidebar while it has no tasks, but not while it is open', async ({ app }) => {
	await expect(app.nav('Inbox')).toBeVisible();
	await expect(app.nav('No date')).toHaveCount(0);

	await app.add('Someday task');
	await app.go('No date');
	await app.row('Someday task').getByRole('checkbox', { name: 'Complete Someday task' }).click();
	await expect(app.page.getByText('Inbox zero')).toBeVisible();
	await expect(app.nav('No date')).toBeVisible();

	await app.go('Inbox');
	await expect(app.nav('No date')).toHaveCount(0);
});

test('dragging a subtask by its handle reorders it, and the arrow keys move it back', async ({ app, page }) => {
	await app.add('Pack for trip');
	await app.row('Pack for trip').getByRole('button', { name: 'Pack for trip', exact: true }).click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of ['Passport', 'Socks', 'Charger']) {
		await add.fill(title);
		await add.press('Enter');
	}
	const rows = app.details().getByRole('list', { name: 'Subtasks of Pack for trip' }).locator('[data-subtask]');
	const titles = () => rows.evaluateAll(items => items.map(item => item.getAttribute('data-subtask')));
	await expect.poll(titles).toEqual(['Passport', 'Socks', 'Charger']);
	await app.settle();

	const handle = (await page.getByRole('button', { name: 'Reorder Charger' }).boundingBox())!;
	const target = (await rows.first().boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, target.y + 4, { steps: 12 });
	await page.mouse.up();
	await expect.poll(titles).toEqual(['Charger', 'Passport', 'Socks']);

	await page.getByRole('button', { name: 'Reorder Charger' }).press('ArrowDown');
	await expect.poll(titles).toEqual(['Passport', 'Charger', 'Socks']);
	await expect(page.getByRole('button', { name: 'Reorder Charger' })).toBeFocused();
});

test('a subtask drags from last to first past a taller row', async ({ app, page }) => {
	const long = 'Book the airport transfer and confirm the pickup details with the hotel concierge so nothing is missed';
	await app.add('Pack for trip');
	await app.row('Pack for trip').getByRole('button', { name: 'Pack for trip', exact: true }).click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of ['Passport', 'Socks', long, 'Charger']) {
		await add.fill(title);
		await add.press('Enter');
	}
	const rows = app.details().getByRole('list', { name: 'Subtasks of Pack for trip' }).locator('[data-subtask]');
	const titles = () => rows.evaluateAll(items => items.map(item => item.getAttribute('data-subtask')));
	await expect.poll(titles).toEqual(['Passport', 'Socks', long, 'Charger']);
	await app.settle();
	const heights = await rows.evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
	expect(heights[2]).toBeGreaterThan(heights[0]! * 1.5);

	const handle = (await page.getByRole('button', { name: 'Reorder Charger' }).boundingBox())!;
	const first = (await rows.first().boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, first.y - 40, { steps: 16 });
	await page.mouse.up();
	await expect.poll(titles).toEqual(['Charger', 'Passport', 'Socks', long]);
});
