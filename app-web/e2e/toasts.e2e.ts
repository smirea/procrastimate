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

test.describe('on a phone', () => {
	test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

	test('a toast glides back down as a sheet closes, and its Undo takes a tap mid-close', async ({ app, page }) => {
		await app.add('Water plants', 'Feed cat');
		await app.row('Water plants').getByRole('checkbox', { name: 'Complete Water plants' }).click();
		const toast = page.getByRole('status').filter({ hasText: 'Water plants' });
		await expect(toast).toBeVisible();
		await app.settle();
		const bottom = (await toast.boundingBox())!.y;

		await app.row('Feed cat').getByRole('button', { name: 'Feed cat', exact: true }).click();
		await expect(app.details()).toBeVisible();
		await app.settle();
		const top = (await toast.boundingBox())!.y;
		expect(top).toBeLessThan(100);

		const closing = await page.evaluate(async () => {
			const status = () =>
				[...document.querySelectorAll('[role="status"]')].find(node => node.textContent?.includes('Water plants'))!;
			document
				.querySelector<HTMLButtonElement>('[role="dialog"][aria-label="Task details"] button[aria-label="Close"]')!
				.click();
			await new Promise(requestAnimationFrame);
			return { overSheet: status().parentElement!.dataset.overSheet, y: status().getBoundingClientRect().y };
		});
		expect(closing.overSheet).toBe('false');
		expect(closing.y).toBeLessThan((top + bottom) / 2);

		await toast.getByRole('button', { name: 'Undo' }).tap();
		await expect(app.row('Water plants').getByRole('checkbox', { name: 'Complete Water plants' })).toBeVisible();
		await expect(toast).toHaveCount(0);
	});

	test('a toast born as a sheet closes appears at the bottom without gliding', async ({ app, page }) => {
		await app.add('Water plants');
		await app.row('Water plants').getByRole('button', { name: 'Water plants', exact: true }).click();
		await app.details().getByRole('button', { name: 'Complete' }).tap();
		const toast = page.getByRole('status').filter({ hasText: 'Water plants' });
		await expect(toast).toBeVisible();
		expect((await toast.boundingBox())!.y).toBeGreaterThan(852 / 2);
	});
});
