import { expect, test, type App } from './fixtures';
import type { Page } from '@playwright/test';

const menu = (page: Page, title: string) => page.getByRole('menu', { name: title });
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const open = (app: App, title: string) => app.row(title).getByRole('button', { name: title, exact: true });

test('a right click on a task row opens its menu, which postpones, completes, deletes, and copies with undo', async ({
	app,
	page,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await app.add('Buy milk today', 'Pay rent today');

	await app.row('Buy milk').click({ button: 'right' });
	await expect(menu(page, 'Buy milk').getByRole('menuitem')).toHaveText([
		'Complete',
		/Tomorrow\s*Thu/,
		/This weekend\s*Sat/,
		/Next week\s*Mon/,
		'Delete',
		'Copy as Markdown',
	]);
	await expect(app.details()).toBeHidden();
	await app.settle();
	await page.screenshot({ path: 'test-results/row-menu/desktop-menu.png' });

	await menu(page, 'Buy milk')
		.getByRole('menuitem', { name: /Tomorrow/ })
		.click();
	await expect(menu(page, 'Buy milk')).toBeHidden();
	await expect(toast(page, 'Moved “Buy milk” to Tomorrow')).toBeVisible();
	const today = page.getByRole('region', { name: 'Today' });
	await expect(today.locator('[data-task="Buy milk"]')).toHaveCount(0);
	await toast(page, 'Moved “Buy milk” to Tomorrow').getByRole('button', { name: 'Undo' }).click();
	await expect(today.locator('[data-task="Buy milk"]')).toBeVisible();

	await app.row('Buy milk').click({ button: 'right' });
	await menu(page, 'Buy milk').getByRole('menuitem', { name: 'Delete' }).click();
	await expect(app.row('Buy milk')).toHaveCount(0);
	await toast(page, 'Deleted “Buy milk”').getByRole('button', { name: 'Undo' }).click();
	await expect(app.row('Buy milk')).toBeVisible();

	await app.row('Buy milk').click({ button: 'right' });
	await menu(page, 'Buy milk').getByRole('menuitem', { name: 'Copy as Markdown' }).click();
	await expect(toast(page, 'Copied as Markdown')).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('- Buy milk');

	await app.row('Buy milk').click({ button: 'right' });
	await menu(page, 'Buy milk').getByRole('menuitem', { name: 'Complete' }).click();
	await expect(app.row('Buy milk')).toHaveCount(0);
	await toast(page, 'Completed “Buy milk”').getByRole('button', { name: 'Undo' }).click();
	await expect(app.row('Buy milk')).toBeVisible();
});

test('Shift+F10 opens the focused row’s menu with its first item focused, and Escape gives focus back', async ({
	app,
	page,
}) => {
	await app.add('Pay rent today');
	await open(app, 'Pay rent').focus();
	await page.keyboard.press('Shift+F10');
	const items = menu(page, 'Pay rent').getByRole('menuitem');
	await expect(items.first()).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(items.nth(1)).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await expect(items.last()).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu(page, 'Pay rent')).toBeHidden();
	await expect(open(app, 'Pay rent')).toBeFocused();

	await page.keyboard.press('Shift+F10');
	await page.keyboard.press('q');
	await expect(app.quickAdd()).toBeVisible();
	await expect(menu(page, 'Pay rent')).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(app.quickAdd()).toBeHidden();
	await open(app, 'Pay rent').focus();

	await page.keyboard.press('Shift+F10');
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowUp');
	await expect(items.nth(-2)).toHaveText('Delete');
	await page.keyboard.press('Enter');
	await expect(toast(page, 'Deleted “Pay rent”')).toBeVisible();
	await expect(app.row('Pay rent')).toHaveCount(0);
});

test('a completed row’s menu reopens and deletes, and a subtask row’s menu toggles it in place', async ({
	app,
	page,
}) => {
	await app.add('Water plants today', 'Pack for trip today');
	await app.row('Water plants').getByRole('checkbox', { name: 'Complete Water plants' }).click();
	await expect(app.row('Water plants')).toHaveCount(0);
	await app.nav('Completed').click();

	await app.row('Water plants').click({ button: 'right' });
	await expect(menu(page, 'Water plants').getByRole('menuitem')).toHaveText(['Reopen', 'Delete', 'Copy as Markdown']);
	await menu(page, 'Water plants').getByRole('menuitem', { name: 'Reopen' }).click();
	await expect(toast(page, 'Reopened “Water plants”')).toBeVisible();
	await expect(app.row('Water plants')).toHaveCount(0);

	await app.go('Inbox');
	await open(app, 'Pack for trip').click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	await add.fill('Passport');
	await add.press('Enter');
	const passport = app.details().locator('[data-subtask="Passport"]');
	await passport.click({ button: 'right' });
	await menu(page, 'Passport').getByRole('menuitem', { name: 'Complete' }).click();
	await expect(passport.getByRole('checkbox', { name: 'Complete Passport' })).toHaveAttribute('aria-checked', 'true');
	await expect(app.details()).toBeVisible();

	await passport.click({ button: 'right' });
	await expect(menu(page, 'Passport').getByRole('menuitem')).toHaveText(['Reopen', 'Delete', 'Copy as Markdown']);
	await page.keyboard.press('Escape');
	await expect(menu(page, 'Passport')).toBeHidden();
	await expect(app.details()).toBeVisible();

	await passport.click({ button: 'right' });
	await menu(page, 'Passport').getByRole('menuitem', { name: 'Delete' }).click();
	await expect(passport).toHaveCount(0);
	await toast(page, 'Deleted “Passport”').getByRole('button', { name: 'Undo' }).click();
	await expect(passport).toBeVisible();
});

test('a search result has the row menu, by right click and by Shift+F10 from the field', async ({ app, page }) => {
	await app.add('Call plumber today', 'Call bank today');
	await page.keyboard.press('/');
	const search = page.getByRole('dialog', { name: 'Search' });
	const field = search.getByRole('combobox', { name: 'Search' });
	await field.fill('call');
	const results = search.getByRole('listbox', { name: 'Search results' });
	await expect(results.getByRole('option')).toHaveCount(2);

	await field.press('Shift+F10');
	const first = (await results.getByRole('option').first().textContent())!.includes('plumber')
		? 'Call plumber'
		: 'Call bank';
	await expect(menu(page, first).getByRole('menuitem').first()).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu(page, first)).toBeHidden();
	await expect(search).toBeVisible();
	await expect(field).toBeFocused();

	await results.getByRole('option', { name: /Call plumber/ }).click({ button: 'right' });
	await app.settle();
	await page.screenshot({ path: 'test-results/row-menu/search-menu.png' });
	await menu(page, 'Call plumber').getByRole('menuitem', { name: 'Delete' }).click();
	await expect(results.getByRole('option')).toHaveCount(1);
	await expect(toast(page, 'Deleted “Call plumber”')).toBeVisible();
	await expect(search).toBeVisible();
});

test.describe('phone', () => {
	test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

	test('a long press opens the row menu instead of the details, and its items take a tap', async ({ app, page }) => {
		await app.add('Buy milk today');
		const cdp = await page.context().newCDPSession(page);
		const box = (await app.row('Buy milk').boundingBox())!;
		const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
		await expect(menu(page, 'Buy milk')).toBeVisible();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await app.settle();
		await expect(app.details()).toBeHidden();
		await page.screenshot({ path: 'test-results/row-menu/phone-menu.png' });

		await menu(page, 'Buy milk')
			.getByRole('menuitem', { name: /Next week/ })
			.tap();
		await expect(toast(page, 'Moved “Buy milk” to')).toBeVisible();
		await expect(menu(page, 'Buy milk')).toBeHidden();

		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(app.details()).toBeVisible();
		await expect(menu(page, 'Buy milk')).toBeHidden();
	});
});
