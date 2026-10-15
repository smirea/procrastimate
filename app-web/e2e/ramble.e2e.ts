import { expect, test } from './fixtures';

test.use({
	permissions: ['microphone'],
	launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

/** The page never names a cassette, so the socket URL gets one here. */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const Native = window.WebSocket;
		window.WebSocket = class extends Native {
			constructor(url: string | URL, protocols?: string | string[]) {
				const next = new URL(url, location.href);
				if (next.pathname === '/api/ramble/socket') next.searchParams.set('cassette', 'party');
				super(next, protocols);
			}
		};
	});
});

test('the ramble drawer streams tasks in, lets them be edited, and saves them all at once', async ({ app, page }) => {
	await app.openSettings();
	await app.dictationOption('ElevenLabs').click();
	await page.keyboard.press('Escape');

	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Ramble' }).click();
	const drawer = page.getByRole('dialog', { name: 'Ramble' });
	await expect(drawer).toBeVisible();
	await expect(app.quickAdd()).toBeHidden();

	const spoken = drawer.getByRole('list', { name: 'Spoken tasks' });
	await expect(spoken.getByText('Buy groceries for the party')).toBeVisible({ timeout: 15_000 });
	await expect(spoken.getByRole('list', { name: 'Subtasks' }).getByText('Bread')).toBeVisible({ timeout: 15_000 });
	await expect(spoken.getByText('Tomorrow 5pm')).toBeVisible({ timeout: 15_000 });
	await expect(spoken.getByText('Renew the passport')).toBeVisible({ timeout: 15_000 });
	await expect(drawer.getByText('remind me at 9am')).toBeVisible({ timeout: 15_000 });

	await drawer.getByRole('button', { name: 'Stop listening' }).click();
	await expect(drawer.getByRole('button', { name: 'Add 3 tasks' })).toBeVisible();

	await drawer.getByRole('button', { name: 'Remove Eggs' }).click();
	await expect(drawer.getByRole('textbox', { name: 'Subtask title', exact: true })).toHaveCount(2);
	await drawer.getByRole('button', { name: 'Remove Renew the passport' }).click();
	const callMom = drawer.getByRole('textbox', { name: 'Task title', exact: true }).nth(1);
	await expect(callMom).toHaveValue('Call mom');
	await callMom.fill('Call mom about the party');
	await drawer.getByRole('button', { name: 'Priority 1' }).click();
	await page.getByRole('button', { name: /Priority 2/ }).click();

	await drawer.getByRole('button', { name: 'Add 2 tasks' }).click();
	await expect(drawer).toBeHidden();

	await app.go('Inbox');
	await expect(app.row('Call mom about the party')).toBeVisible();
	await app.go('No date');
	const groceries = app.row('Buy groceries for the party');
	await expect(groceries).toBeVisible();
	await expect(groceries.getByText('0/2')).toBeVisible();
});

test('Escape stops listening first, and closing discards the ramble', async ({ app, page }) => {
	await app.openSettings();
	await app.dictationOption('ElevenLabs').click();
	await page.keyboard.press('Escape');

	await app.openQuickAdd();
	await app.quickAdd().getByRole('button', { name: 'Ramble' }).click();
	const drawer = page.getByRole('dialog', { name: 'Ramble' });
	await expect(drawer.getByRole('list', { name: 'Spoken tasks' }).getByText('Buy groceries for the party')).toBeVisible(
		{ timeout: 15_000 },
	);

	await page.keyboard.press('Escape');
	await expect(drawer.getByRole('button', { name: /^Add/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(drawer).toBeHidden();
	await expect(app.row('Buy groceries for the party')).toHaveCount(0);
});
