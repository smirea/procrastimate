import { expect, test } from './fixtures';

test('going back from a subtask returns to where the parent was scrolled', async ({ app, page }) => {
	await app.add('Pack for trip');
	await page.setViewportSize({ width: 393, height: 852 });
	await app
		.row('Pack for trip')
		.getByRole('button', { name: /^Pack for trip/ })
		.click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (let i = 1; i <= 25; i++) {
		await add.fill(`Item ${i}`);
		await add.press('Enter');
	}
	const body = app.details().locator('.overflow-y-auto').first();
	const scrollTop = () => body.evaluate(el => Math.round(el.scrollTop));

	await body.evaluate(el => (el.scrollTop = 0));
	const area = (await body.boundingBox())!;
	await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
	await page.mouse.wheel(0, 500);
	await expect.poll(scrollTop).toBe(500);

	// Clicking a subtask the body clips would scroll it into view first, and the scroll would move the place to return to.
	const item = app.details().getByRole('button', { name: /^Item 15/ });
	await expect(item).toBeInViewport({ ratio: 1 });
	await item.click();
	await app.details().getByRole('button', { name: 'Back to Pack for trip' }).click();
	await expect(item).toBeVisible();
	await expect.poll(scrollTop).toBe(500);

	// Opening the task afresh starts at the top.
	await app.details().getByRole('button', { name: 'Close' }).click();
	await expect(app.details()).toBeHidden();
	await app
		.row('Pack for trip')
		.getByRole('button', { name: /^Pack for trip/ })
		.click();
	await expect(app.details().getByRole('textbox', { name: 'Add subtask' })).toBeVisible();
	await expect.poll(scrollTop).toBe(0);
});
