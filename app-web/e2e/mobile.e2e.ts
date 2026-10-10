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

async function shot(app: App, name: string) {
	await app.settle();
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
	await app.settle();
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
	await app.settle();
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
	await app.settle();
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

test('a slashed weekday list repeats and the repeat menu adds a day by touch', async ({ app, page }) => {
	await add(app, 'Yoga tue/thu 6pm');
	const row = app.row('Yoga');
	await expect(row).toContainText('Tomorrow 6pm');
	await expect(row.getByRole('img', { name: 'Repeats every Tue, Thu' })).toBeVisible();

	await row.getByRole('button', { name: /Yoga/ }).tap();
	const details = app.details();
	await details.getByRole('button', { name: 'Repeats every Tue, Thu' }).tap();
	const menu = page.getByRole('dialog', { name: 'Repeat' });
	const day = (name: string) => menu.getByRole('button', { name, exact: true });
	await expect.poll(async () => (await day('Mon').boundingBox())?.height).toBeGreaterThanOrEqual(44);
	const viewport = page.viewportSize()!;
	for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
		const box = (await day(name).boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
	}
	await day('Sat').tap();
	await expect(details.getByRole('button', { name: 'Repeats every Tue, Thu, Sat' })).toBeVisible();
	await expect(day('Sat')).toHaveAttribute('aria-pressed', 'true');
	await shot(app, 'recurrence-weekdays');
	const header = (await details.locator('header').boundingBox())!;
	expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(header.y + header.height);
	await details.getByRole('button', { name: 'Close' }).tap();
	await expect(details).toBeHidden();

	await row.getByRole('checkbox', { name: 'Complete Yoga' }).tap();
	await expect(page.getByRole('status').filter({ hasText: 'Completed “Yoga”, next due Saturday 6pm' })).toBeVisible();
	await expect(row).toContainText('Saturday 6pm');
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
	await app.settle();
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

test('in a Safari tab the Notifications sheet explains Add to Home Screen first', async ({ app, page }) => {
	await openNav(app);
	const row = nav(app).getByRole('button', { name: /^Notifications/ });
	await expect(row).toHaveText(/^\s*Notifications\s*Set up\s*$/);
	expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await row.tap();
	await expect(nav(app)).toHaveCount(0);

	const sheet = page.getByRole('dialog', { name: 'Notifications' });
	await expect(sheet.getByRole('heading', { name: 'Add Procrastimate to your Home Screen' })).toBeVisible();
	await expect(sheet.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveText([
		/^\s*1\s*Tap Share in Safari’s toolbar\.\s*$/,
		/^\s*2\s*Choose Add to Home Screen\.\s*$/,
		/^\s*3\s*Open Procrastimate from your Home Screen and turn on notifications here\.\s*$/,
	]);
	await shot(app, 'notifications-install');
	await sheet.getByRole('button', { name: 'Got it' }).tap();
	await expect(sheet).toBeHidden();
});

async function openSettings(app: App) {
	await openNav(app);
	await nav(app).getByRole('button', { name: 'Settings' }).tap();
	await expect(app.settings()).toBeVisible();
	await expect(nav(app)).toHaveCount(0);
}

test('the settings sheet switches the theme and keeps it across reloads', async ({ app, page }) => {
	await openSettings(app);
	await settle(app);
	expect(await bottom(app.settings())).toBeGreaterThan(page.viewportSize()!.height - 40);
	await expect(app.themeOption('System')).toHaveAttribute('aria-checked', 'true');
	expect((await app.themeOption('Dark').boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await page.screenshot({ path: 'test-results/settings-import/mobile-sheet-light.png' });
	await page.emulateMedia({ colorScheme: 'dark' });
	await app.expectTheme('dark');
	await settle(app);
	await page.screenshot({ path: 'test-results/settings-import/mobile-sheet-dark.png' });

	await app.themeOption('Light').tap();
	await app.expectTheme('light');
	await page.reload();
	await openSettings(app);
	await expect(app.themeOption('Light')).toHaveAttribute('aria-checked', 'true');
	await app.expectTheme('light');

	await app.themeOption('System').tap();
	await app.expectTheme('dark');
	await app.settings().getByRole('button', { name: 'Close settings' }).tap();
	await expect(app.settings()).toHaveCount(0);
});

test('the saved theme applies before the app loads on a phone', async ({ app }) => {
	await openSettings(app);
	await app.themeOption('Dark').tap();
	await app.expectFirstPaintTheme('dark');
	await app.expectTheme('dark');
});

test('importing a Todoist backup twice from the settings sheet adds each task once', async ({ app, page }) => {
	await openSettings(app);
	const button = app.settings().getByRole('button', { name: 'Import from Todoist' });
	expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await app.importBackup('tap');
	await expect(app.importSummary()).toContainText('2 projects');
	await expect(app.importSummary()).toContainText('12 tasks');
	await expect(app.importSummary()).toContainText('0 skipped');
	await settle(app);
	await page.screenshot({ path: 'test-results/settings-import/mobile-summary-light.png' });

	await app.importBackup('tap');
	await expect(app.importSummary()).toContainText('12 skipped');
	await expect(app.importSummary()).toContainText('0 tasks');
	await app.settings().getByRole('button', { name: 'Close settings' }).tap();
	await expect(app.page.locator('[data-task]')).toHaveCount(5);
	await expect(app.row('Call the dentist')).toHaveCount(1);
});

test('@ suggests labels above the keyboard, rows show chips, and the drawer opens a label', async ({ app, page }) => {
	await openQuickAdd(app);
	await openKeyboard(app);
	await app.taskInput().pressSequentially('Call plumber @calls');
	const list = page.getByRole('listbox', { name: 'Labels' });
	await expect(list.getByRole('option')).toHaveText(['Create label “calls”']);
	await app.settle();
	const box = (await list.boundingBox())!;
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.y + box.height).toBeLessThanOrEqual((await app.taskInput().boundingBox())!.y);
	await shot(app, 'label-autocomplete');
	await list.getByRole('option', { name: 'Create label “calls”' }).tap();
	await expect(app.taskInput()).toHaveValue('Call plumber @calls ');
	await expect(app.taskInput()).toBeFocused();
	await app.quickAdd().getByRole('button', { name: 'Add task' }).tap();
	await app.quickAdd().getByRole('button', { name: 'Cancel' }).tap();

	const row = app.row('Call plumber');
	await expect(row.locator('.label-chip')).toHaveText(['calls']);
	await shot(app, 'label-chips');

	await row.getByRole('button', { name: /Call plumber/ }).tap();
	await app.details().getByRole('button', { name: 'Labels calls' }).tap();
	const picker = page.getByRole('dialog', { name: 'Labels' });
	const filter = picker.getByRole('textbox', { name: 'Find or create a label' });
	await expect(filter).not.toBeFocused();
	await filter.fill('waiting');
	await picker.getByRole('menuitemcheckbox', { name: 'Create label “waiting”' }).tap();
	await expect(picker.getByRole('menuitemcheckbox', { name: 'waiting' })).toHaveAttribute('aria-checked', 'true');
	await app.settle();
	const menu = (await picker.boundingBox())!;
	expect(menu.y).toBeGreaterThanOrEqual(0);
	expect(menu.y + menu.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await shot(app, 'label-picker');
	await app.details().getByRole('button', { name: 'Close' }).tap();
	await expect(app.details()).toBeHidden();
	await expect(row.locator('.label-chip')).toHaveText(['calls', 'waiting']);

	await go(app, 'waiting');
	await expect(app.list('waiting tasks').getByRole('listitem')).toHaveText([/Call plumber.*Inbox/]);
	await shot(app, 'label-view');

	await openNav(app);
	await nav(app).getByRole('button', { name: 'Search' }).tap();
	await page.getByRole('combobox', { name: 'Search' }).fill('cal');
	const results = page.getByRole('listbox', { name: 'Search results' });
	await expect(results.getByRole('group', { name: /^Labels/ }).getByRole('option')).toHaveText(['calls']);
	await results.getByRole('option', { name: 'calls', exact: true }).tap();
	await expect(page.getByRole('heading', { level: 1, name: 'calls' })).toBeVisible();
	await expect(app.list('calls tasks').getByRole('listitem')).toHaveText([/Call plumber/]);
});

test('subtasks are added, checked, and dragged into order by touch in the task sheet', async ({ app, page }) => {
	await add(app, 'Pack for trip');
	await app
		.row('Pack for trip')
		.getByRole('button', { name: /Pack for trip/ })
		.tap();
	const input = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of ['Passport', 'Charger', 'Socks']) {
		await input.fill(title);
		await input.press('Enter');
		await expect(input).toHaveValue('');
	}
	await app.details().getByRole('checkbox', { name: 'Complete Passport' }).tap();
	await expect(app.details().getByRole('checkbox', { name: 'Complete Passport' })).toBeChecked();

	const handle = app.details().getByRole('button', { name: 'Reorder Socks' });
	const hit = await handle.evaluate(node => {
		const area = getComputedStyle(node, '::before');
		return [parseFloat(area.width), parseFloat(area.height)];
	});
	expect(Math.min(...hit)).toBeGreaterThanOrEqual(44);
	await app.details().locator('[data-subtask="Socks"]').scrollIntoViewIfNeeded();
	await expect(app.details().locator('[data-subtask="Passport"]')).toBeInViewport();
	const from = (await handle.boundingBox())!;
	const target = (await app.details().locator('[data-subtask="Passport"]').boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
	await page.mouse.up();
	const rows = app.details().getByRole('list', { name: 'Subtasks of Pack for trip' }).getByRole('listitem');
	await expect(rows).toHaveText([/Socks/, /Passport/, /Charger/]);
	await shot(app, 'subtasks-details');

	await app.details().getByRole('button', { name: 'Close' }).tap();
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
});
