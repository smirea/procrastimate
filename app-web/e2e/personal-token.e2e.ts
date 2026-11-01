import { request as http } from '@playwright/test';
import { expect, test } from './fixtures.ts';

test('a personal token adds tasks as the user until it is revoked', async ({ app, page, baseURL }) => {
	await app.openSettings();
	const section = app.settings().getByRole('region', { name: 'Personal token' });
	await section.getByRole('button', { name: 'Generate token' }).click();
	await expect(section.getByLabel('Token', { exact: true })).toHaveText(/^pm\./, { timeout: 10_000 });
	const token = (await section.getByLabel('Token', { exact: true }).textContent())!;

	const launcher = await http.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } });
	const added = await launcher.post('/api/tasks', { data: { title: 'From my launcher' } });
	expect(added.status()).toBe(200);
	await page.keyboard.press('Escape');
	await app.go('No date');
	await expect(app.row('From my launcher')).toBeVisible({ timeout: 10_000 });
	await expect(app.row('From my launcher')).not.toContainText('by');

	await app.openSettings();
	await section.getByRole('button', { name: 'Revoke personal tokens' }).click();
	await section.getByRole('button', { name: 'Revoke all' }).click();
	await expect(section.getByRole('button', { name: 'Revoke personal tokens' })).toHaveCount(0);
	await expect.poll(async () => (await launcher.get('/api/view')).status()).toBe(401);
	await launcher.dispose();
});
