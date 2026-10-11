import { expect, test } from './fixtures.ts';

test('priority-nl: typed priorities set the level', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Pay rent p1');
	await expect(app.highlight('priority')).toHaveText('p1');
	await expect(app.quickAdd().getByRole('button', { name: 'Priority 1' })).toBeVisible();
	await snap('priority-nl');
	await app.taskInput().press('Enter');
	for (const title of ['Fix sink !!', 'Call bank urgent']) {
		await app.taskInput().fill(title);
		await app.taskInput().press('Enter');
	}
	await app.cancelQuickAdd();
	await expect(app.checkbox('Pay rent')).toHaveAttribute('style', /--p1/);
	await expect(app.checkbox('Fix sink')).toHaveAttribute('style', /--p2/);
	await expect(app.checkbox('Call bank')).toHaveAttribute('style', /--p1/);
});

test('priority-picker: the flag menu sets the level', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Pay rent');
	await app.quickAdd().getByRole('button', { name: 'Priority 4' }).tap();
	await app.page.getByRole('dialog', { name: 'Priority' }).getByRole('button', { name: 'Priority 2' }).tap();
	await expect(app.page.getByRole('dialog', { name: 'Priority' })).toBeHidden();
	await expect(app.quickAdd().getByRole('button', { name: 'Priority 2' })).toBeVisible();
	await snap('priority-picker');
	await app.quickAdd().getByRole('button', { name: 'Add task' }).tap();
	await app.cancelQuickAdd();
	await expect(app.checkbox('Pay rent')).toHaveAttribute('style', /--p2/);
});

test('priority-replace: a picked level removes the typed one', async ({ app, snap }) => {
	await app.openQuickAdd();
	await app.type('Pay rent p1');
	await expect(app.highlight('priority')).toHaveText('p1');
	await app.quickAdd().getByRole('button', { name: 'Priority 1' }).tap();
	await app.page.getByRole('dialog', { name: 'Priority' }).getByRole('button', { name: 'Priority 3' }).tap();
	await expect(app.page.getByRole('dialog', { name: 'Priority' })).toBeHidden();
	await expect(app.taskInput()).toHaveValue('Pay rent ');
	await expect(app.quickAdd().getByRole('button', { name: 'Priority 3' })).toBeVisible();
	await snap('priority-replace');
	await app.quickAdd().getByRole('button', { name: 'Add task' }).tap();
	await app.cancelQuickAdd();
	await expect(app.checkbox('Pay rent')).toHaveAttribute('style', /--p3/);
});

test('priority-display: the checkbox is tinted by priority', async ({ app, snap }) => {
	await app.add('Urgent p1', 'High p2', 'Medium p3', 'Plain');
	for (const [title, level] of [['Urgent', 1], ['High', 2], ['Medium', 3], ['Plain', 4]] as const) {
		await expect(app.checkbox(title)).toHaveAttribute('style', new RegExp(`--p${level}`));
	}
	await snap('priority-display');
});
