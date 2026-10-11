import { expect, NOW, test } from './fixtures.ts';
import { chip, closeDetails, details, menu, openDetails, retitle, titleInput } from './details-fixtures.ts';

test('edit-open: tapping a row opens its details', async ({ app, snap }) => {
	await app.add('Buy milk');
	await openDetails(app, 'Buy milk');
	await expect(details(app).getByRole('textbox', { name: 'Notes' })).toHaveValue('');
	await expect(chip(app, 'Set due date')).toBeVisible();
	await expect(chip(app, 'Priority 4')).toBeVisible();
	await snap('edit-open');
});

test('edit-fields: title, notes, date, and priority save as they change and after relaunch', async ({ app, snap }) => {
	await app.add('Buy milk');
	await openDetails(app, 'Buy milk');
	await retitle(app, 'Buy oat milk');
	await expect(titleInput(app)).toHaveValue('Buy oat milk');
	await details(app).getByRole('textbox', { name: 'Notes' }).fill('2 cartons');
	await chip(app, 'Set due date').tap();
	await menu(app, 'Due date').getByRole('button', { name: 'Tomorrow' }).tap();
	await expect(menu(app, 'Due date')).toBeHidden();
	await expect(chip(app, 'Due Tomorrow')).toBeVisible();
	await chip(app, 'Priority 4').tap();
	await menu(app, 'Priority').getByRole('button', { name: 'Priority 1' }).tap();
	await expect(menu(app, 'Priority')).toBeHidden();
	await expect(chip(app, 'Priority 1')).toBeVisible();
	await snap('edit-fields');
	await closeDetails(app);
	await expect(app.row('Buy oat milk')).toContainText('2 cartons');

	await app.relaunch(NOW);
	await openDetails(app, 'Buy oat milk');
	await expect(details(app).getByRole('textbox', { name: 'Notes' })).toHaveValue('2 cartons');
	await expect(chip(app, 'Due Tomorrow')).toBeVisible();
	await expect(chip(app, 'Priority 1')).toBeVisible();
});

test('edit-nl: phrases in the title apply on return', async ({ app, snap }) => {
	await app.add('Water plants');
	await openDetails(app, 'Water plants');
	await retitle(app, 'Water plants fri 6pm !! remind me 1h before');
	await expect(titleInput(app)).toHaveValue('Water plants');
	await expect(chip(app, 'Due Friday 6pm')).toBeVisible();
	await expect(chip(app, 'Priority 2')).toBeVisible();
	await expect(chip(app, '1 reminder')).toBeVisible();
	await snap('edit-nl');
});

test('edit-config-row: the chips show parsed values before return applies them', async ({ app, snap }) => {
	await app.add('Standup');
	await openDetails(app, 'Standup');
	await titleInput(app).press('End');
	await titleInput(app).pressSequentially(' fri 6pm');
	await expect(details(app).locator('[data-token="due"]')).toHaveText('fri 6pm');
	await expect(chip(app, 'Due Friday 6pm')).toBeVisible();
	await snap('edit-config-row');
	await titleInput(app).press('Enter');
	await expect(titleInput(app)).toHaveValue('Standup');
	await closeDetails(app);
	await expect(app.row('Standup')).toContainText('Friday 6pm');
});

test('edit-delete: Delete task removes it, and Undo restores it', async ({ app, snap }) => {
	await app.add('Buy milk', 'Pay rent');
	await openDetails(app, 'Buy milk');
	await details(app).getByRole('button', { name: 'Delete task' }).tap();
	await expect(details(app)).toBeHidden();
	await expect(app.row('Buy milk')).toHaveCount(0);
	await expect(app.toast('Deleted “Buy milk”')).toBeVisible();
	await snap('edit-delete');
	await app.toast('Deleted “Buy milk”').getByRole('button', { name: 'Undo' }).tap();
	await expect(app.row('Buy milk')).toBeVisible();
});

test('reminders-picker: presets, a custom time, and remove', async ({ app, snap }) => {
	await app.add('Call mom tomorrow 5pm');
	await openDetails(app, 'Call mom');
	await chip(app, 'Add reminder').tap();
	await menu(app, 'Reminders').getByRole('button', { name: '30m before' }).tap();
	await expect(chip(app, '1 reminder')).toBeVisible();
	await chip(app, '1 reminder').tap();
	await menu(app, 'Reminders').getByRole('button', { name: 'Add reminder' }).tap();
	await expect(chip(app, '2 reminders')).toBeVisible();
	await chip(app, '2 reminders').tap();
	const reminders = menu(app, 'Reminders');
	await expect(reminders.getByText('30m before', { exact: true })).toHaveCount(2);
	await expect(reminders.getByText('Tomorrow 9am', { exact: true })).toBeVisible();
	await snap('reminders-picker');
	await reminders.getByRole('button', { name: 'Remove reminder' }).first().tap();
	await expect(chip(app, '1 reminder')).toBeVisible();
	await expect(reminders.getByText('Tomorrow 9am', { exact: true })).toBeVisible();
});

test('projects-move: the project menu moves the task', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('#Home');
	await app.quickAdd().getByRole('option', { name: 'Create project “Home”' }).tap();
	await app.taskInput().fill('Buy milk');
	await app.taskInput().press('Enter');
	await app.cancelQuickAdd();
	await openDetails(app, 'Buy milk');
	await chip(app, 'Project Inbox').tap();
	await menu(app, 'Project').getByRole('button', { name: 'Home' }).tap();
	await expect(menu(app, 'Project')).toBeHidden();
	await expect(chip(app, 'Project Home')).toBeVisible();
	await snap('projects-move');
	await closeDetails(app);
	await expect(app.row('Buy milk')).toHaveCount(0);
});

test('labels-picker: toggles and creates labels while it stays open', async ({ app, snap }) => {
	await app.add('Call mom');
	await openDetails(app, 'Call mom');
	await chip(app, 'Add labels').tap();
	const labels = menu(app, 'Labels');
	const find = labels.getByRole('textbox', { name: 'Find or create a label' });
	await find.fill('calls');
	await labels.getByRole('menuitemcheckbox', { name: 'Create label “calls”' }).tap();
	await find.fill('errands');
	await labels.getByRole('menuitemcheckbox', { name: 'Create label “errands”' }).tap();
	await expect(chip(app, 'Labels calls, errands')).toBeVisible();
	await labels.getByRole('menuitemcheckbox', { name: 'calls' }).tap();
	await expect(labels.getByRole('menuitemcheckbox', { name: 'calls' })).toHaveAttribute('aria-checked', 'false');
	await expect(labels.getByRole('menuitemcheckbox', { name: 'errands' })).toHaveAttribute('aria-checked', 'true');
	await expect(chip(app, 'Labels errands')).toBeVisible();
	await snap('labels-picker');
	await app.page.keyboard.press('Escape');
	await closeDetails(app);
	await expect(app.row('Call mom')).toContainText('errands');
});
