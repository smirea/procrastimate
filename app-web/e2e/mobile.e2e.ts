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

async function shot(app: App, name: string) {
	await app.page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
	await app.page.screenshot({ path: `test-results/mobile/${name}.png` });
}

test('the navigation drawer switches views and projects', async ({ app, page }) => {
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

	const keyboard = 300;
	await page.evaluate(height => {
		const visual = window.visualViewport!;
		Object.defineProperty(visual, 'height', { configurable: true, get: () => window.innerHeight - height });
		visual.dispatchEvent(new Event('resize'));
	}, keyboard);
	await expect
		.poll(async () => {
			const box = (await sheet.boundingBox())!;
			return box.y + box.height;
		})
		.toBeLessThanOrEqual(viewport.height - keyboard);

	await sheet.getByRole('button', { name: 'Add task' }).tap();
	await expect(app.taskInput()).toHaveValue('');
	await sheet.getByRole('button', { name: 'Cancel' }).tap();

	const row = app.row('Call mom');
	await expect(row).toContainText('Tomorrow 5pm');
	await expect(row.getByLabel('1 reminders')).toBeVisible();
	await expect(row.getByRole('checkbox', { name: 'Complete Call mom' })).toHaveAttribute('style', /--p1/);
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
