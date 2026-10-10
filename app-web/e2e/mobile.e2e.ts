import type { Locator } from '@playwright/test';
import { expect, test, type App } from './fixtures.ts';

const nav = (app: App) => app.page.getByRole('navigation', { name: 'Main' });

async function openNav(app: App) {
	await app.page.getByRole('button', { name: 'Open navigation' }).tap();
	await expect(nav(app)).toBeVisible();
}

async function go(app: App, view: string) {
	await openNav(app);
	await app.nav(view).tap();
	await expect(app.page.getByRole('heading', { level: 1, name: view })).toBeVisible();
	await expect(nav(app)).toHaveCount(0);
}

async function openQuickAdd(app: App) {
	await app.page.getByRole('button', { name: 'Quick add' }).tap();
	await expect(app.taskInput()).toBeFocused();
}

/** Adds each task with the on-screen keyboard's return key, then dismisses the sheet. */
async function add(app: App, ...titles: string[]) {
	await openQuickAdd(app);
	for (const title of titles) {
		await app.taskInput().fill(title);
		await app.taskInput().press('Enter');
		await expect(app.taskInput()).toHaveValue('');
	}
	await app.quickAdd().getByRole('button', { name: 'Cancel' }).tap();
	await expect(app.quickAdd()).toBeHidden();
}

const KEYBOARD = 300;

/** Playwright cannot raise the iOS keyboard, so shrink the visual viewport the way it does. */
async function openKeyboard(app: App) {
	await app.page.evaluate(height => {
		const visual = window.visualViewport!;
		Object.defineProperty(visual, 'height', { configurable: true, get: () => window.innerHeight - height });
		visual.dispatchEvent(new Event('resize'));
	}, KEYBOARD);
}

const bottom = async (locator: Locator) => {
	const box = (await locator.boundingBox())!;
	return box.y + box.height;
};

const settle = (app: App) =>
	app.page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));

async function shot(app: App, name: string) {
	await settle(app);
	await app.page.screenshot({ path: `test-results/mobile/${name}.png` });
}

test('the navigation drawer opens, closes, and switches views', async ({ app, page }) => {
	await expect(page.getByText('Tap + to capture a task.')).toBeVisible();
	await add(
		app,
		'Standup today 10:30am p2',
		'Review PR today 3pm p1 remind me 30m before',
		'Call mom tomorrow 5pm',
		'Dentist in 3 days 2pm',
		'Buy milk',
	);
	await shot(app, 'inbox');
	await expect(nav(app)).toHaveCount(0);

	await openNav(app);
	await shot(app, 'navigation-open');
	await page.mouse.click(370, 400);
	await expect(nav(app)).toHaveCount(0);

	await go(app, 'Today');
	await expect(app.list('Today tasks').getByRole('listitem')).toHaveText([/Standup/, /Review PR/]);
	await shot(app, 'today');

	await go(app, 'Upcoming');
	await expect(page.getByRole('region', { name: 'Oct 17 · Saturday' }).getByRole('listitem')).toHaveText([/Dentist/]);
	await shot(app, 'upcoming');
});

test('the navigation drawer creates a project and switches to it', async ({ app, page }) => {
	await openNav(app);
	await page.getByRole('button', { name: 'Add project' }).tap();
	await page.getByRole('textbox', { name: 'Project name' }).fill('Home');
	await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
	await expect(nav(app)).toHaveCount(0);
	await add(app, 'Fix sink #home p3', 'Paint fence fri');

	await go(app, 'Inbox');
	await go(app, 'Home');
	await expect(app.list('Home tasks').getByRole('listitem')).toHaveText([/Paint fence/, /Fix sink/]);
	await shot(app, 'project');
});

test('# suggests projects above the keyboard and a tap picks or creates one', async ({ app, page }) => {
	for (const name of ['Home', 'Errands']) {
		await openNav(app);
		await page.getByRole('button', { name: 'Add project' }).tap();
		await page.getByRole('textbox', { name: 'Project name' }).fill(name);
		await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
		await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
	}
	await openQuickAdd(app);
	await openKeyboard(app);
	await app.taskInput().pressSequentially('Fix sink #h');

	const suggestions = page.getByRole('listbox', { name: 'Projects' });
	await expect(suggestions.getByRole('option')).toHaveText(['Home', 'Create project “h”']);
	await settle(app);
	const list = (await suggestions.boundingBox())!;
	expect(list.y).toBeGreaterThanOrEqual(0);
	expect(list.y + list.height).toBeLessThanOrEqual((await app.taskInput().boundingBox())!.y);
	await shot(app, 'project-autocomplete');

	await suggestions.getByRole('option', { name: 'Home' }).tap();
	await expect(app.taskInput()).toHaveValue('Fix sink #Home ');
	await expect(app.taskInput()).toBeFocused();
	await expect(suggestions).toBeHidden();

	await app.taskInput().pressSequentially('#Garden');
	await expect(suggestions.getByRole('option')).toHaveText(['Create project “Garden”']);
	await shot(app, 'project-autocomplete-create');
	await suggestions.getByRole('option').tap();
	await expect(app.taskInput()).toHaveValue('Fix sink #Home #Garden ');
	await expect(app.quickAdd().getByRole('button', { name: 'Project Garden' })).toBeVisible();
});

test('quick add previews timing above the input with the keyboard open', async ({ app, page }) => {
	await openQuickAdd(app);
	await openKeyboard(app);
	await app.taskInput().pressSequentially('Standup every mon 9am remind me 10m before');
	const preview = page.getByRole('status', { name: 'Timing preview' });
	await expect(preview).toHaveText(
		'Mon Oct 19 at 9:00 AM · Repeats every Mon · Notifies at 9:00 AM · Remind 10 min before (8:50 AM)',
	);
	await settle(app);
	const box = (await preview.boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual((await app.taskInput().boundingBox())!.y);
	await shot(app, 'timing-preview');

	await app.taskInput().fill('Standup');
	await expect(preview).toHaveCount(0);
});

test('quick add docks above the keyboard and parses a reminder and priority', async ({ app, page }) => {
	await openQuickAdd(app);
	const viewport = page.viewportSize()!;
	const sheet = app.quickAdd();
	const docked = (await sheet.boundingBox())!;
	expect(viewport.height - (docked.y + docked.height)).toBeLessThanOrEqual(40);
	expect(docked.width).toBeGreaterThan(viewport.width - 32);

	await app.taskInput().pressSequentially('Call mom tomorrow 5pm remind me 30m before p1');
	await expect(sheet.locator('[data-token="due"]')).toHaveText('tomorrow 5pm');
	await expect(sheet.locator('[data-token="reminder"]')).toHaveText('remind me 30m before');
	await expect(sheet.locator('[data-token="priority"]')).toHaveText('p1');
	await expect(sheet.getByRole('button', { name: 'Due Tomorrow 5pm' })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await expect(sheet.getByText('30m before', { exact: true })).toBeVisible();
	await shot(app, 'quick-add');

	await openKeyboard(app);
	await expect.poll(async () => bottom(sheet)).toBeLessThanOrEqual(viewport.height - KEYBOARD);

	await sheet.getByRole('button', { name: 'Add task' }).tap();
	await expect(app.taskInput()).toHaveValue('');
	await sheet.getByRole('button', { name: 'Cancel' }).tap();

	const row = app.row('Call mom');
	await expect(row).toContainText('Tomorrow 5pm');
	await expect(row.getByLabel('1 reminders')).toBeVisible();
	await expect(row.getByRole('checkbox', { name: 'Complete Call mom' })).toHaveAttribute('style', /--p1/);
});

test('quick add parses shorthands and keeps a name as text', async ({ app }) => {
	await openQuickAdd(app);
	const sheet = app.quickAdd();
	await app.taskInput().pressSequentially('Pay Tom back eow r1h');
	await expect(sheet.locator('[data-token="due"]')).toHaveText('eow');
	await expect(sheet.locator('[data-token="reminder"]')).toHaveText('r1h');
	await expect(sheet.getByRole('button', { name: 'Due Friday 5pm' })).toBeVisible();
	await expect(sheet.getByText('1h before', { exact: true })).toBeVisible();
	await sheet.getByRole('button', { name: 'Add task' }).tap();
	await expect(app.taskInput()).toHaveValue('');

	await app.taskInput().pressSequentially('Water plants every day 9am');
	await expect(sheet.locator('[data-token="recurrence"]')).toHaveText('every day');
	await expect(sheet.getByText('Every day', { exact: true })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Due Tomorrow 9am' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Add task' }).tap();
	await sheet.getByRole('button', { name: 'Cancel' }).tap();

	await expect(app.row('Pay Tom back')).toContainText('Friday 5pm');
	await expect(app.row('Pay Tom back').getByLabel('1 reminders')).toBeVisible();
	await expect(app.row('Water plants')).toContainText('Tomorrow 9am');
});

test('task details open as a sheet and edit fields', async ({ app, page }) => {
	await add(app, 'Water plants');
	await app
		.row('Water plants')
		.getByRole('button', { name: /Water plants/ })
		.tap();
	const details = app.details();
	const title = details.getByRole('textbox', { name: 'Title' });
	await expect(title).toHaveValue('Water plants');

	await title.fill('Water plants fri 6pm !! remind me 1h before');
	await title.press('Enter');
	await expect(title).toHaveValue('Water plants');
	await expect(details.getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
	await expect(details.getByRole('button', { name: '1 reminder' })).toBeVisible();
	await details.getByRole('textbox', { name: 'Notes' }).fill('The ferns too');

	await details.getByRole('button', { name: 'Priority 2' }).tap();
	const menu = page.getByRole('dialog', { name: 'Priority' });
	const box = (await menu.boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await menu.getByRole('button', { name: 'Priority 1' }).tap();
	await expect(menu).toBeHidden();
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await shot(app, 'task-details');

	await openKeyboard(app);
	const limit = page.viewportSize()!.height - KEYBOARD;
	await expect.poll(async () => bottom(details)).toBeLessThanOrEqual(limit);
	expect(await bottom(details.getByRole('button', { name: 'Delete task' }))).toBeLessThanOrEqual(limit);
	const chip = details.getByRole('button', { name: 'Due Friday 6pm' });
	await chip.scrollIntoViewIfNeeded();
	expect(await bottom(chip)).toBeLessThanOrEqual(limit);

	await details.getByRole('button', { name: 'Close' }).tap();
	await expect(details).toBeHidden();
	await expect(app.row('Water plants')).toContainText('The ferns too');

	await page.reload();
	await app
		.row('Water plants')
		.getByRole('button', { name: /Water plants/ })
		.tap();
	await expect(details.getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
	await expect(details.getByRole('button', { name: 'Priority 1' })).toBeVisible();
});

test('task details set a repeat by touch and completing rolls the task forward', async ({ app, page }) => {
	await add(app, 'Water plants every 2d');
	const row = app.row('Water plants');
	await expect(row).toContainText('Today');
	await expect(row.getByRole('img', { name: 'Repeats every 2 days' })).toBeVisible();

	await row.getByRole('button', { name: /Water plants/ }).tap();
	const details = app.details();
	await details.getByRole('button', { name: 'Repeats every 2 days' }).tap();
	const menu = page.getByRole('dialog', { name: 'Repeat' });
	await settle(app);
	const box = (await menu.boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await shot(app, 'recurrence-menu');
	await menu.getByRole('button', { name: 'Every weekday' }).tap();
	await expect(details.getByRole('button', { name: 'Repeats every weekday' })).toBeVisible();
	await shot(app, 'recurrence-details');
	await details.getByRole('button', { name: 'Close' }).tap();

	await row.getByRole('checkbox', { name: 'Complete Water plants' }).tap();
	await expect(page.getByRole('status').filter({ hasText: 'next due Tomorrow' })).toBeVisible();
	await expect(row).toContainText('Tomorrow');
});

test('a tap just outside the checkbox completes the task and undo restores it', async ({ app, page }) => {
	await add(app, 'Buy milk', 'Pay rent');
	const checkbox = app.row('Buy milk').getByRole('checkbox', { name: 'Complete Buy milk' });
	const box = (await checkbox.boundingBox())!;
	await page.touchscreen.tap(box.x - 8, box.y + box.height / 2);
	await expect(app.row('Buy milk')).toHaveCount(0);

	const undo = page.getByRole('status').getByRole('button', { name: 'Undo' });
	const toast = (await page.getByRole('status').boundingBox())!;
	const fab = (await page.getByRole('button', { name: 'Quick add' }).boundingBox())!;
	expect(toast.y + toast.height).toBeLessThanOrEqual(fab.y);
	await undo.tap();
	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveText([/Buy milk/, /Pay rent/]);
});

test('search opens from the drawer, docks above the keyboard, and a tap opens a task', async ({ app, page }) => {
	await add(app, 'Fix sink p2', 'Water plants tomorrow', 'Call plumber');
	await openNav(app);
	await nav(app).getByRole('button', { name: 'Search' }).tap();
	await expect(nav(app)).toHaveCount(0);
	const sheet = page.getByRole('dialog', { name: 'Search' });
	const field = sheet.getByRole('combobox', { name: 'Search' });
	await expect(field).toBeFocused();

	await openKeyboard(app);
	await field.pressSequentially('pl');
	const results = page.getByRole('listbox', { name: 'Search results' });
	await expect(results.getByRole('option')).toHaveText([/Water plants\s+Tomorrow/, /Call plumber/]);
	await expect(results.locator('mark')).toHaveText(['pl', 'pl']);
	expect((await results.getByRole('option', { name: /Call plumber/ }).boundingBox())!.height).toBeGreaterThanOrEqual(
		44,
	);
	await settle(app);
	const box = (await sheet.boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - KEYBOARD);
	expect(await bottom(results)).toBeLessThanOrEqual((await field.boundingBox())!.y);
	await page.screenshot({ path: 'test-results/search/mobile-light.png' });
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');
	await page.evaluate(() => Promise.allSettled(document.getAnimations().map(animation => animation.finished)));
	await page.screenshot({ path: 'test-results/search/mobile-dark.png' });

	await results.getByRole('option', { name: /Water plants/ }).tap();
	await expect(sheet).toHaveCount(0);
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Water plants');
});

test('the drawer theme switcher overrides the color scheme and persists across reloads', async ({ app, page }) => {
	await openNav(app);
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	expect((await app.themeOption('Dark').boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');

	await app.themeOption('Light').tap();
	await app.expectTheme('light');
	await page.reload();
	await openNav(app);
	await expect(app.themeOption('Light')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');

	await app.themeOption('System').tap();
	await app.expectTheme('dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await app.expectTheme('light');
});

test('the saved theme applies before the app loads on a phone', async ({ app }) => {
	await openNav(app);
	await app.themeOption('Dark').tap();
	await app.expectFirstPaintTheme('dark');
	await app.expectTheme('dark');
});
