import { expect, test } from './fixtures';

test('an action toast waits while hovered or focused, then counts down what it had left', async ({ app, page }) => {
	await app.add('Water plants');
	await app.row('Water plants').getByRole('checkbox', { name: 'Complete Water plants' }).click();
	const toast = page.getByRole('status').filter({ hasText: 'Water plants' });
	const undo = toast.getByRole('button', { name: 'Undo' });
	await expect(undo).toBeVisible();

	await toast.hover();
	await page.clock.runFor(10_000);
	await expect(toast).toBeVisible();

	await undo.focus();
	await page.mouse.move(0, 0);
	await page.clock.runFor(10_000);
	await expect(toast).toBeVisible();

	await undo.blur();
	await page.clock.runFor(5_500);
	await expect(toast).toHaveCount(0);
});
