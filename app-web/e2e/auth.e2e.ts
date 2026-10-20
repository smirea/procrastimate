import { expect, quietTest as test } from './fixtures';

test('email sign-up is the first screen, and a signed-in reload checks the session with one sync token request and asks for nothing else of auth', async ({
	page,
}) => {
	await page.goto('/inbox');
	await expect(page.getByRole('heading', { name: 'ProcrastiMate' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Sign in with Apple' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Create an account' }).click();
	await page.getByLabel('Email').fill(`e2e-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}@procrastimate.test`);
	await page.getByLabel('Password').fill('e2e-password-1');
	const connected = page.waitForResponse('**/api/sync/token');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	await connected;

	const requests: string[] = [];
	page.on('request', request => {
		const path = new URL(request.url()).pathname;
		if (/^\/api\/(auth|sync)\//.test(path)) requests.push(path);
	});
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.procrastimate.pending())).toBe(0);
	expect(requests).toEqual(['/api/sync/token']);
});
