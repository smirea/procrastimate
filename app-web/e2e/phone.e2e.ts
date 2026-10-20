import { expect, test } from './fixtures';

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

test('the drawer creates a project, switches views, and quick add saves into the open project', async ({
	app,
	page,
}) => {
	await app.openNavigation();
	await app.createProject('Errands');
	await expect(page.getByRole('navigation', { name: 'Main' })).not.toBeInViewport();
	await app.openQuickAdd();
	await app.taskInput().fill('Fix sink');
	await app.quickAdd().getByRole('button', { name: 'Add task' }).tap();
	await expect(app.quickAdd()).toBeHidden();
	await expect(app.list('Errands tasks').locator('[data-task="Fix sink"]')).toBeVisible();

	await app.openNavigation();
	await app.nav('Inbox').tap();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main' })).not.toBeInViewport();
});

test('the settings sheet floats at the bottom edge and keeps a theme across a reload', async ({ app, page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.openNavigation();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Settings' }).tap();
	await expect(app.settings()).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main' })).not.toBeInViewport();
	await app.settle();
	const sheet = (await app.settings().boundingBox())!;
	expect({ left: sheet.x, right: sheet.x + sheet.width, bottom: sheet.y + sheet.height }).toEqual({
		left: 8,
		right: 393 - 8,
		bottom: 852 - 8,
	});
	for (const name of ['System', 'Light', 'Dark'] as const)
		expect((await app.themeOption(name).boundingBox())!.height).toBeGreaterThanOrEqual(44);

	await app.themeOption('Light').tap();
	await app.expectTheme('light');
	await app.reload();
	await app.expectTheme('light');
	await app.openNavigation();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Settings' }).tap();
	await expect(app.themeOption('Light')).toHaveAttribute('aria-checked', 'true');
	await page.getByRole('button', { name: 'Close settings' }).tap();
	await expect(app.settings()).toBeHidden();
});

test('subtasks are added and checked by touch in the task sheet, and the row shows progress', async ({ app, page }) => {
	await app.add('Pack for trip tomorrow');
	await app.row('Pack for trip').getByRole('button', { name: 'Pack for trip', exact: true }).tap();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of ['Passport', 'Charger', 'Socks']) {
		await add.fill(title);
		await add.press('Enter');
	}
	await expect(
		app.details().getByRole('list', { name: 'Subtasks of Pack for trip' }).locator('[data-subtask]'),
	).toHaveText([/Passport/, /Charger/, /Socks/]);
	const passport = app.details().getByRole('checkbox', { name: 'Complete Passport', exact: true });
	await passport.tap();
	await expect(passport).toHaveAttribute('aria-checked', 'true');
	await app.closeDetails();
	const row = app.row('Pack for trip');
	await expect(row.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
	await expect(row).toContainText('1/3');
	await app.reload();
	await expect(row.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
});

test('a repeating task added by touch rolls to its next date when checked off', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Water plants every day 9am');
	await expect(app.quickAdd().getByText('Every day', { exact: true })).toBeVisible();
	await expect(app.quickAdd().getByRole('button', { name: 'Due Tomorrow 9am' })).toBeVisible();
	await app.quickAdd().getByRole('button', { name: 'Add task' }).tap();
	await expect(app.quickAdd()).toBeHidden();

	const row = app.row('Water plants');
	await expect(row).toContainText('Tomorrow 9am');
	await expect(row.getByRole('img', { name: 'Repeats every day' })).toBeVisible();
	await row.getByRole('checkbox', { name: 'Complete Water plants' }).tap();
	await expect(page.getByText('Completed “Water plants”, next due Friday 9am')).toBeVisible();
	await expect(row.filter({ hasText: 'Friday 9am' })).toBeVisible();
	await expect(row).toHaveCount(1);
});

test('search opens from the drawer above the keyboard, and a tap opens a task or a label', async ({ app, page }) => {
	await app.add('Water plants tomorrow');
	await app.addCreating('@calls Call plumber');
	await app.openNavigation();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Search' }).tap();
	const search = page.getByRole('dialog', { name: 'Search' });
	const field = search.getByRole('combobox', { name: 'Search' });
	await expect(field).toBeFocused();
	await expect(page.getByRole('navigation', { name: 'Main' })).not.toBeInViewport();
	await page.evaluate(() => document.documentElement.style.setProperty('--keyboard-inset', '300px'));
	await field.fill('pl');
	const results = search.getByRole('listbox', { name: 'Search results' });
	await expect(results.getByRole('option')).toHaveText([/Call plumber/, /Water plants/]);
	await app.settle();
	const sheet = (await search.boundingBox())!;
	expect(sheet.y).toBeGreaterThanOrEqual(0);
	expect(sheet.y + sheet.height).toBeLessThanOrEqual(852 - 300);
	await results.getByRole('option', { name: /Water plants/ }).tap();
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Water plants');
	await app.closeDetails();

	await app.openNavigation();
	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Search' }).tap();
	await field.fill('cal');
	await results.getByRole('option', { name: /^calls/ }).tap();
	await expect(page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	await expect(app.list('calls tasks').locator('[data-task]')).toHaveText([/Call plumber/]);
});
