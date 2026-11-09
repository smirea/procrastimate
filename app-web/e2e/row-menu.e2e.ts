import { expect, test, type App } from './fixtures';
import type { Page } from '@playwright/test';

const menu = (page: Page, title: string) => page.getByRole('menu', { name: title });
const chooser = (page: Page, title: string) => page.getByRole('dialog', { name: `Postpone ${title}` });
const tile = (page: Page, title: string, label: string) =>
	chooser(page, title).getByRole('button', { name: label, exact: true });
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const open = (app: App, title: string) => app.row(title).getByRole('button', { name: title, exact: true });

test('a right click or Shift+F10 opens a task row’s menu, which postpones, completes, reopens, deletes, and copies with undo', async ({
	app,
	page,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await app.add('Buy milk today', 'Pay rent today');

	await app.row('Buy milk').click({ button: 'right' });
	await expect(menu(page, 'Buy milk').getByRole('menuitem')).toHaveText([
		'Complete',
		'Postpone',
		'Delete',
		'Copy as Markdown',
	]);
	await expect(app.details()).toBeHidden();
	await app.settle();
	await page.screenshot({ path: 'test-results/row-menu/desktop-menu.png' });

	await menu(page, 'Buy milk').getByRole('menuitem', { name: 'Postpone' }).click();
	await expect(menu(page, 'Buy milk')).toBeHidden();
	await tile(page, 'Buy milk', 'Tomorrow').click();
	await expect(chooser(page, 'Buy milk')).toBeHidden();
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

	await app.row('Buy milk').getByRole('checkbox', { name: 'Complete Buy milk' }).click();
	await expect(app.row('Buy milk')).toHaveCount(0);
	await app.nav('Completed').click();
	await app.row('Buy milk').click({ button: 'right' });
	await expect(menu(page, 'Buy milk').getByRole('menuitem')).toHaveText(['Reopen', 'Delete', 'Copy as Markdown']);
	await menu(page, 'Buy milk').getByRole('menuitem', { name: 'Reopen' }).click();
	await expect(toast(page, 'Reopened “Buy milk”')).toBeVisible();
	await expect(app.row('Buy milk')).toHaveCount(0);

	await app.go('Inbox');
	await open(app, 'Buy milk').click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	await add.fill('Oat milk');
	await add.press('Enter');
	const oat = app.details().locator('[data-subtask="Oat milk"]');
	await oat.click({ button: 'right' });
	await menu(page, 'Oat milk').getByRole('menuitem', { name: 'Complete' }).click();
	await expect(oat.getByRole('checkbox', { name: 'Complete Oat milk' })).toHaveAttribute('aria-checked', 'true');
	await expect(app.details()).toBeVisible();
	await oat.click({ button: 'right' });
	await expect(menu(page, 'Oat milk').getByRole('menuitem')).toHaveText(['Reopen', 'Delete', 'Copy as Markdown']);
	await page.keyboard.press('Escape');
	await expect(menu(page, 'Oat milk')).toBeHidden();
	await expect(app.details()).toBeVisible();
});

test('postponing keeps the time, and Next empty day skips every day that has a task', async ({ app, page }) => {
	await app.add('Pay rent today 2pm', 'Call mom oct 16', 'Gym oct 17');
	await app.setNow(new Date('2026-10-15T14:00:00Z'));
	await app.reload();

	await app.row('Pay rent').getByRole('button', { name: 'Postpone Pay rent' }).click();
	await expect(chooser(page, 'Pay rent').locator('.tile')).toHaveText([
		/Today\s*Thu/,
		/Tomorrow\s*Fri/,
		/In 2 days\s*Sat/,
		/Next week\s*Mon/,
		/Next month\s*Sun/,
		/Next empty day\s*Sun/,
		'No date',
	]);
	await app.settle();
	await page.screenshot({ path: 'test-results/row-menu/desktop-postpone.png' });
	await tile(page, 'Pay rent', 'Tomorrow').click();
	await expect(toast(page, 'Moved “Pay rent” to Tomorrow')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Tomorrow' }).locator('[data-task="Pay rent"]')).toContainText('2pm');

	await app.row('Pay rent').click({ button: 'right' });
	await menu(page, 'Pay rent').getByRole('menuitem', { name: 'Postpone' }).click();
	await tile(page, 'Pay rent', 'Next empty day').click();
	await expect(toast(page, 'Moved “Pay rent” to Sunday')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Sunday' }).locator('[data-task="Pay rent"]')).toContainText('2pm');

	await app.row('Pay rent').getByRole('button', { name: 'Postpone Pay rent' }).click();
	await chooser(page, 'Pay rent').getByRole('button', { name: 'Tuesday, October 20, 2026' }).click();
	await expect(chooser(page, 'Pay rent')).toBeHidden();
	await expect(toast(page, 'Moved “Pay rent” to Tuesday')).toBeVisible();
	await toast(page, 'Moved “Pay rent” to Tuesday').getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByRole('region', { name: 'Sunday' }).locator('[data-task="Pay rent"]')).toBeVisible();
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

		await menu(page, 'Buy milk').getByRole('menuitem', { name: 'Postpone' }).tap();
		await expect(menu(page, 'Buy milk')).toBeHidden();
		await app.settle();
		await page.screenshot({ path: 'test-results/row-menu/phone-postpone.png' });
		await tile(page, 'Buy milk', 'Next week').tap();
		await expect(toast(page, 'Moved “Buy milk” to')).toBeVisible();
		await expect(chooser(page, 'Buy milk')).toBeHidden();

		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(app.details()).toBeVisible();
		await expect(menu(page, 'Buy milk')).toBeHidden();
	});
});
