import { expect, test } from './fixtures.ts';

test('complete-check: the checkbox completes and the row leaves', async ({ app, snap }) => {
	await app.add('Pay rent', 'Buy milk');
	await app.checkbox('Pay rent').tap();
	await expect(app.row('Pay rent')).toHaveCount(0);
	await expect(app.toast('Completed “Pay rent”')).toBeVisible();
	await expect(app.row('Buy milk')).toBeVisible();
	await snap('complete-check');
});

test('complete-undo: Undo restores the row', async ({ app, snap }) => {
	await app.add('Pay rent');
	await app.checkbox('Pay rent').tap();
	await expect(app.row('Pay rent')).toHaveCount(0);
	await app.toast('Completed “Pay rent”').getByRole('button', { name: 'Undo' }).tap();
	await expect(app.row('Pay rent')).toBeVisible();
	await snap('complete-undo');
});

test('complete-recurring: a repeating task moves to its next occurrence', async ({ app, snap }) => {
	await app.add('Standup every fri 9am');
	await expect(app.row('Standup')).toContainText('Friday 9am');
	await app.checkbox('Standup').tap();
	await expect(app.toast('Completed “Standup”, next due Oct 23 9am')).toBeVisible();
	await expect(app.row('Standup')).toContainText('Oct 23 9am');
	await snap('complete-recurring');
});
