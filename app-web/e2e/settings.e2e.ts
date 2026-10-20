import { expect, test } from './fixtures';

test('settings keep the dictation choice and the pinned quick add buttons across a reload', async ({ app, page }) => {
	await expect(page.getByRole('radiogroup', { name: 'Theme' })).toHaveCount(0);
	await app.openSettings();
	await expect(app.settings().getByText(/^Version \d+\.\d{8}$/)).toBeVisible();
	await expect(app.settings().getByRole('button', { name: 'Delete account' })).toHaveCount(0);
	await expect(app.dictationOption('Native')).toHaveAttribute('aria-checked', 'true');
	await app.dictationOption('ElevenLabs').click();
	await expect(app.dictationOption('ElevenLabs')).toHaveAttribute('aria-checked', 'true');

	const buttons = app.settings().getByRole('group', { name: 'Quick add buttons' }).getByRole('button');
	const pressed = () =>
		buttons.evaluateAll(all =>
			all.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent!.trim()),
		);
	await expect.poll(pressed).toEqual(['Date', 'Priority', 'Reminders', 'Subtasks']);
	await buttons.filter({ hasText: 'Labels' }).click();
	await expect(buttons.filter({ hasText: 'Labels' })).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await expect(app.settings()).toBeHidden();

	await app.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Add labels' })).toBeVisible();
	await page.keyboard.press('Escape');
	await app.openSettings();
	await expect(app.dictationOption('ElevenLabs')).toHaveAttribute('aria-checked', 'true');
	await expect.poll(pressed).toEqual(['Date', 'Priority', 'Reminders', 'Subtasks', 'Labels']);
});

test('dragging a shown quick add button reorders the row', async ({ app, page }) => {
	await app.openSettings();
	const group = app.settings().getByRole('group', { name: 'Quick add buttons' });
	const pressed = () =>
		group.getByRole('button', { pressed: true }).evaluateAll(all => all.map(b => b.textContent!.trim()));
	await expect.poll(pressed).toEqual(['Date', 'Priority', 'Reminders', 'Subtasks']);

	const handle = group.getByRole('button', { name: 'Reorder Subtasks' });
	const target = group.getByRole('button', { name: 'Date', exact: true });
	// Hovering waits for the handle to stop moving, since the dialog can still shift as the first sync lands.
	await handle.hover();
	await page.mouse.down();
	const from = (await handle.boundingBox())!;
	const to = (await target.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 12 });
	await page.mouse.up();
	await expect.poll(pressed).toEqual(['Subtasks', 'Date', 'Priority', 'Reminders']);

	await group.getByRole('button', { name: 'Reorder Reminders' }).focus();
	await page.keyboard.press('ArrowUp');
	await expect.poll(pressed).toEqual(['Subtasks', 'Date', 'Reminders', 'Priority']);
	await page.keyboard.press('Escape');

	await app.reload();
	await app.openQuickAdd();
	const row = app.quickAdd().getByRole('group', { name: 'Task attributes' }).locator('[data-button]');
	await expect
		.poll(() => row.evaluateAll(all => all.map(b => b.getAttribute('data-button'))))
		.toEqual(['subtasks', 'date', 'reminders', 'priority']);
});
