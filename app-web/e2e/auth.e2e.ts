import { expect, test } from '@playwright/test';

test('email sign-up is the first screen and opens the inbox', async ({ page }) => {
	await page.goto('/inbox');
	await expect(page.getByRole('heading', { name: 'ProcrastiMate' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Sign in with Apple' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Create an account' }).click();
	const email = `e2e-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}@procrastimate.test`;
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
});
