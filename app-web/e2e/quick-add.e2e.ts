import { expect, test } from './fixtures.ts';

test('q opens quick add, parses the brief example inline, and saves it', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('call mom tomorrow 5pm remind me 30m before p1');

	const quickAdd = app.quickAdd();
	await expect(quickAdd.locator('[data-token="due"]')).toHaveText('tomorrow 5pm');
	await expect(quickAdd.locator('[data-token="reminder"]')).toHaveText('remind me 30m before');
	await expect(quickAdd.locator('[data-token="priority"]')).toHaveText('p1');
	await expect(quickAdd.getByRole('button', { name: 'Due Tomorrow 5pm' })).toBeVisible();
	await expect(quickAdd.getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await expect(quickAdd.getByText('30m before', { exact: true })).toBeVisible();
	await quickAdd.screenshot({ path: 'test-results/quick-add-parsed.png' });

	await app.taskInput().press('Enter');
	await expect(app.taskInput()).toHaveValue('');
	await expect(app.taskInput()).toBeFocused();

	const row = app.row('call mom');
	await expect(row).toContainText('Tomorrow 5pm');
	await expect(row.getByLabel('1 reminders')).toBeVisible();
	await expect(row.getByRole('checkbox', { name: 'Complete call mom' })).toHaveAttribute('style', /--p1/);

	await page.reload();
	await expect(app.row('call mom')).toContainText('Tomorrow 5pm');
});

test('shorthands parse inline while names and ordinary words stay text', async ({ app, page }) => {
	await app.openQuickAdd();
	const quickAdd = app.quickAdd();
	await app.taskInput().pressSequentially('Call Tom about the sun hat tom 5p r30m');
	await expect(quickAdd.locator('[data-token="due"]')).toHaveText('tom 5p');
	await expect(quickAdd.locator('[data-token="reminder"]')).toHaveText('r30m');
	await expect(quickAdd.getByRole('button', { name: 'Due Tomorrow 5pm' })).toBeVisible();
	await expect(quickAdd.getByText('30m before', { exact: true })).toBeVisible();
	await app.taskInput().press('Enter');

	await app.taskInput().fill('Standup every mon 9:30a');
	await expect(quickAdd.locator('[data-token="recurrence"]')).toHaveText('every mon');
	await expect(quickAdd.locator('[data-token="due"]')).toHaveText('9:30a');
	await expect(quickAdd.getByText('Every Mon', { exact: true })).toBeVisible();
	await expect(quickAdd.getByRole('button', { name: 'Due Monday 9:30am' })).toBeVisible();
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');

	await expect(app.row('Call Tom about the sun hat')).toContainText('Tomorrow 5pm');
	await expect(app.row('Standup')).toContainText('Monday 9:30am');
	await page.reload();
	await expect(app.row('Standup')).toContainText('Monday 9:30am');
});

test('saving lands the task in Inbox and keeps quick add open for the next one', async ({ app }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Buy milk');
	await app.taskInput().press('Enter');
	await app.taskInput().fill('Pay rent');
	await app.taskInput().press('Enter');
	await expect(app.list('Inbox tasks').getByRole('listitem')).toHaveCount(2);
	await expect(app.quickAdd()).toBeVisible();
});

test('a due date typed into the title is removed from the title', async ({ app }) => {
	await app.add('Call mom tomorrow');
	await expect(app.row('Call mom')).toContainText('Tomorrow');
	await expect(app.row('Call mom tomorrow')).toHaveCount(0);
});

test('Escape discards the draft', async ({ app }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Discard me');
	await app.taskInput().press('Escape');
	await expect(app.quickAdd()).toBeHidden();
	await expect(app.row('Discard me')).toHaveCount(0);
});

test('keep as text un-parses a highlighted phrase', async ({ app }) => {
	await app.openQuickAdd();
	await app.taskInput().fill('Read Monday Night Club');
	await expect(app.quickAdd().locator('[data-token="due"]')).toHaveText('Monday');
	await app.quickAdd().getByRole('button', { name: 'Keep as text' }).click();
	await expect(app.quickAdd().locator('[data-token]')).toHaveCount(0);
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');
	await expect(app.row('Read Monday Night Club')).toHaveText('Read Monday Night Club');
});

test('the add button in a list opens quick add', async ({ app, page }) => {
	await page.getByRole('main').getByRole('button', { name: 'Add task' }).click();
	await expect(app.taskInput()).toBeFocused();
});

test('q typed inside a text field is just a letter', async ({ app }) => {
	await app.openQuickAdd();
	await app.taskInput().press('q');
	await expect(app.taskInput()).toHaveValue('q');
});

test('the configuration row spells out parsed timing with no preview above the input', async ({ app, page }) => {
	await app.openQuickAdd();
	await app.taskInput().pressSequentially('Standup every mon 9am remind me 10m before');
	const quickAdd = app.quickAdd();
	await expect(quickAdd.getByRole('button', { name: 'Due Monday 9am' })).toBeVisible();
	await expect(quickAdd.getByText('Every Mon', { exact: true })).toBeVisible();
	await expect(quickAdd.getByText('10m before', { exact: true })).toBeVisible();
	await expect(page.getByRole('status', { name: 'Timing preview' })).toHaveCount(0);
	await app.taskInput().press('Enter');
	await app.taskInput().press('Escape');

	await app.row('Standup').getByRole('button', { name: 'Standup' }).click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.press('End');
	await title.pressSequentially(' fri 6pm');
	await expect(app.details().locator('[data-token="due"]')).toHaveText('fri 6pm');
	await expect(page.getByRole('status', { name: 'Timing preview' })).toHaveCount(0);
	await expect(app.details().getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
	await expect(app.row('Standup')).not.toContainText('Fri');
	await title.press('Enter');
	await expect(app.details().getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
	await expect(app.row('Standup')).toContainText('Fri');
});
