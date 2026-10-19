import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * Requests outside sync answer slowly or fail on purpose here, to prove the UI changes the moment the user acts and
 * puts things back with a toast when the server refuses.
 */

const SLOW = 2_000;
/** Well under `SLOW`, so passing means the UI moved before the server answered. */
const INSTANT = { timeout: 1_000 };

/** Holds matching requests for `SLOW`, then lets them through, or answers 500 when `refused`. */
async function slow(page: Page, path: string, method: string, refused = false) {
	await page.route(`**${path}`, async (route: Route) => {
		if (route.request().method() !== method) return route.fallback();
		await new Promise(resolve => setTimeout(resolve, SLOW));
		await (refused ? route.fulfill({ status: 500, body: '{}' }) : route.fallback());
	});
}

const refuse = (page: Page, path: string, method: string) => slow(page, path, method, true);

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('an AI account shows at once, its token holds a place until the server makes it, and delete is instant', async ({
	app,
	page,
}) => {
	await slow(page, '/api/ai', 'POST');
	await slow(page, '/api/ai-tokens', 'POST');
	await app.openSettings();
	const section = app.settings().getByRole('region', { name: 'AI accounts' });
	await section.getByRole('textbox', { name: 'AI account name' }).fill('Robo');
	await section.getByRole('textbox', { name: 'AI account name' }).press('Enter');
	await expect(section.getByText('Robo')).toBeVisible(INSTANT);
	await expect(section.getByRole('textbox', { name: 'AI account name' })).toHaveValue('');

	await section.getByRole('button', { name: 'Generate token' }).click();
	await expect(section.getByRole('status', { name: 'Making a token' })).toBeVisible(INSTANT);
	await expect(section.getByLabel('Token')).toHaveText(/^pm\./, { timeout: 10_000 });

	await section.getByRole('button', { name: 'Delete Robo' }).click();
	await section.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(section.getByText('Robo')).toHaveCount(0, INSTANT);
});

test('a refused AI account goes away with a toast', async ({ app, page }) => {
	await refuse(page, '/api/ai', 'POST');
	await app.openSettings();
	const section = app.settings().getByRole('region', { name: 'AI accounts' });
	await section.getByRole('textbox', { name: 'AI account name' }).fill('Robo');
	await section.getByRole('button', { name: 'Create AI account' }).click();
	await expect(section.getByText('Robo')).toBeVisible(INSTANT);
	await expect(toast(page, 'Could not create Robo')).toBeVisible({ timeout: 10_000 });
	await expect(section.getByText('Robo')).toHaveCount(0);
});

test('a new link holds a place until the server makes it, and a refused stop puts it back', async ({ app, page }) => {
	await app.createProject('Errands');
	await slow(page, '/api/shares*', 'POST');
	await refuse(page, '/api/shares*', 'DELETE');
	await (await app.listMenu()).getByRole('button', { name: 'Share' }).click();
	const sheet = page.getByRole('dialog', { name: 'Share' });
	await sheet.getByRole('button', { name: 'Copy link' }).click();
	await expect(sheet.getByRole('status', { name: 'Making the link' })).toBeVisible(INSTANT);
	await expect(sheet.getByLabel('Link')).toHaveText(/\/s\/.+/, { timeout: 10_000 });

	await sheet.getByRole('button', { name: 'Stop sharing' }).click();
	await expect(sheet.getByLabel('Link')).toHaveCount(0, INSTANT);
	await expect(toast(page, 'Could not stop sharing')).toBeVisible({ timeout: 10_000 });
	await expect(sheet.getByLabel('Link')).toHaveText(/\/s\/.+/);
});

test('a link stopped while it is made stays stopped once the server makes it', async ({ app, page }) => {
	await app.createProject('Errands');
	await slow(page, '/api/shares*', 'POST');
	await (await app.listMenu()).getByRole('button', { name: 'Share' }).click();
	const sheet = page.getByRole('dialog', { name: 'Share' });
	await sheet.getByRole('button', { name: 'Copy link' }).click();
	await expect(sheet.getByRole('status', { name: 'Making the link' })).toBeVisible(INSTANT);
	const revoked = page.waitForResponse(r => r.url().includes('/api/shares') && r.request().method() === 'DELETE');
	await sheet.getByRole('button', { name: 'Stop sharing' }).click();
	await expect(sheet.getByText('Anyone with the link')).toHaveCount(0, INSTANT);
	expect((await revoked).ok()).toBe(true);
	await expect(sheet.getByText('Anyone with the link')).toHaveCount(0);
});

test('sign out is instant, and a refused one signs back in with a toast', async ({ app, page }) => {
	await refuse(page, '/api/auth/sign-out', 'POST');
	await app.openSettings();
	await app.settings().getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible(INSTANT);
	await expect(toast(page, 'Could not sign out')).toBeVisible({ timeout: 10_000 });
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});

test('people the space has met match before the server answers, and adding one is instant', async ({ app, page }) => {
	await app.openSettings();
	const section = app.settings().getByRole('region', { name: 'AI accounts' });
	await section.getByRole('textbox', { name: 'AI account name' }).fill('Robo');
	await section.getByRole('textbox', { name: 'AI account name' }).press('Enter');
	await expect(section.getByRole('button', { name: 'Delete Robo' })).toBeVisible();
	await page.keyboard.press('Escape');

	await app.createProject('Errands');
	await slow(page, '/api/people*', 'GET');
	await slow(page, '/api/shares*', 'POST');
	await (await app.listMenu()).getByRole('button', { name: 'Share' }).click();
	const sheet = page.getByRole('dialog', { name: 'Share' });
	await sheet.getByRole('textbox', { name: 'Email or name' }).fill('Ro');
	await sheet.getByRole('list', { name: 'People found' }).getByRole('button', { name: /Robo/ }).click(INSTANT);
	await expect(sheet.getByRole('region', { name: 'People with access' })).toContainText('Robo', INSTANT);
});
