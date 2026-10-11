import { expect, test } from './fixtures.ts';
import {
	addSubtasks,
	addWithSubtasks,
	closeDetails,
	details,
	openDetails,
	subtask,
	subtaskCheckbox,
	subtaskInput,
	subtaskRows,
	titleInput,
} from './details-fixtures.ts';

test('subtasks-add: Add subtask parses like quick add and keeps focus', async ({ app, snap }) => {
	await addWithSubtasks(app, 'Pack for trip', 'Passport', 'Charger tomorrow p1');
	await expect(subtaskInput(app)).toBeFocused();
	await expect(subtaskRows(app)).toHaveText([/Passport/, /Charger/]);
	await expect(subtask(app, 'Charger')).toContainText('Tomorrow');
	await snap('subtasks-add');
});

test('subtasks-progress: the parent row shows done/total', async ({ app, snap }) => {
	await addWithSubtasks(app, 'Pack for trip', 'Passport', 'Charger', 'Socks');
	await subtaskCheckbox(app, 'Passport').tap();
	await closeDetails(app);
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible();
	await expect(app.row('Passport')).toHaveCount(0);
	await snap('subtasks-progress');
});

test('subtasks-check: the checkbox toggles a subtask with no toast', async ({ app, snap }) => {
	await addWithSubtasks(app, 'Pack for trip', 'Passport', 'Charger');
	await subtaskCheckbox(app, 'Passport').tap();
	await expect(subtaskCheckbox(app, 'Passport')).toBeChecked();
	await expect(app.page.getByRole('status').filter({ hasText: 'Completed' })).toHaveCount(0);
	await snap('subtasks-check');
	await subtaskCheckbox(app, 'Passport').tap();
	await expect(subtaskCheckbox(app, 'Passport')).not.toBeChecked();
});

test('subtasks-reorder: a subtask drags into place by its handle', async ({ app, snap }) => {
	await addWithSubtasks(app, 'Pack for trip', 'Passport', 'Charger', 'Socks');
	const handle = details(app).getByRole('button', { name: 'Reorder Socks' });
	await subtask(app, 'Socks').scrollIntoViewIfNeeded();
	await expect(subtask(app, 'Passport')).toBeInViewport();
	const from = (await handle.boundingBox())!;
	const target = (await subtask(app, 'Passport').boundingBox())!;
	// Playwright cannot synthesize a touch drag, so the phone profile drags with the mouse.
	await app.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await app.page.mouse.down();
	await app.page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
	await app.page.mouse.up();
	await expect(subtaskRows(app)).toHaveText([/Socks/, /Passport/, /Charger/]);
	await snap('subtasks-reorder');
});

test('subtasks-nest: a subtask opens its own details with a way back', async ({ app, snap }) => {
	await addWithSubtasks(app, 'Pack for trip', 'Charger');
	await subtask(app, 'Charger')
		.getByRole('button', { name: /^Charger/ })
		.tap();
	await expect(titleInput(app)).toHaveValue('Charger');
	await expect(details(app).getByRole('button', { name: 'Back to Pack for trip' })).toBeVisible();
	await addSubtasks(app, 'Cable');
	await snap('subtasks-nest');
	await details(app).getByRole('button', { name: 'Back to Pack for trip' }).tap();
	await expect(titleInput(app)).toHaveValue('Pack for trip');
	await expect(subtask(app, 'Charger').getByRole('img', { name: '0 of 1 subtasks done' })).toBeVisible();
});

test('subtasks-complete-parent: completing a parent completes its subtasks and undo restores each', async ({
	app,
	snap,
}) => {
	await addWithSubtasks(app, 'Pack for trip', 'Passport', 'Charger');
	await subtaskCheckbox(app, 'Passport').tap();
	await closeDetails(app);
	await app.checkbox('Pack for trip').tap();
	await expect(app.row('Pack for trip')).toHaveCount(0);
	await app.toast('Completed “Pack for trip”').getByRole('button', { name: 'Undo' }).tap();
	await expect(app.row('Pack for trip').getByRole('img', { name: '1 of 2 subtasks done' })).toBeVisible();
	await openDetails(app, 'Pack for trip');
	await expect(subtaskCheckbox(app, 'Passport')).toBeChecked();
	await expect(subtaskCheckbox(app, 'Charger')).not.toBeChecked();
	await snap('subtasks-complete-parent');
});

test('subtasks-recurring: completing a recurring parent reopens its subtasks', async ({ app, snap }) => {
	await app.add('Weekly review every fri');
	await openDetails(app, 'Weekly review');
	await addSubtasks(app, 'Inbox zero', 'Plan week');
	await subtaskCheckbox(app, 'Inbox zero').tap();
	await subtaskCheckbox(app, 'Plan week').tap();
	await closeDetails(app);
	await expect(app.row('Weekly review').getByRole('img', { name: '2 of 2 subtasks done' })).toBeVisible();
	await app.checkbox('Weekly review').tap();
	await expect(app.row('Weekly review')).toContainText('Oct 23');
	await expect(app.row('Weekly review').getByRole('img', { name: '0 of 2 subtasks done' })).toBeVisible();
	await snap('subtasks-recurring');
});

test('subtasks-dated: a dated subtask shows in Today under its parent', async ({ app, snap }) => {
	await addWithSubtasks(app, 'Pack for trip', 'Buy adapter today');
	await closeDetails(app);
	await expect(app.row('Buy adapter')).toHaveCount(0);
	await app.go('Today');
	await expect(app.row('Buy adapter').getByLabel('Subtask of Pack for trip')).toBeVisible();
	await snap('subtasks-dated');
});
