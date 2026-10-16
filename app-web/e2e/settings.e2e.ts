import { expect, test } from './fixtures';

test('settings keep the dictation choice and the pinned quick add buttons across a reload', async ({ app, page }) => {
	await expect(page.getByRole('radiogroup', { name: 'Theme' })).toHaveCount(0);
	await app.openSettings();
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

	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await app.openQuickAdd();
	await expect(app.quickAdd().getByRole('button', { name: 'Add labels' })).toBeVisible();
	await page.keyboard.press('Escape');
	await app.openSettings();
	await expect(app.dictationOption('ElevenLabs')).toHaveAttribute('aria-checked', 'true');
	await expect.poll(pressed).toEqual(['Date', 'Priority', 'Reminders', 'Labels', 'Subtasks']);
});
