import { expect, test } from './fixtures';

const LONG =
	'Call the plumber about the leaking kitchen sink and ask whether they can also look at the water pressure in the upstairs bathroom';

test('a row shows two lines of title with its labels inline, and a long title gives way to the labels', async ({
	app,
	page,
}) => {
	await app.openQuickAdd();
	await app.taskInput().fill(`${LONG} @home`);
	await page.getByRole('option', { name: 'Create label “home”' }).click();
	await app.taskInput().press('Enter');
	await expect(app.quickAdd()).toBeHidden();
	await app.add('Short task @home');
	await app.nav('No date').click();

	const short = app.row('Short task');
	const long = app.row(LONG);
	const lineHeight = 20;
	for (const width of [1280, 393]) {
		await page.setViewportSize({ width, height: 800 });
		for (const row of [short, long]) {
			const flow = row.locator('.flow');
			const chip = row.locator('[data-label="home"]');
			await expect(chip).toBeVisible();
			const [flowBox, chipBox] = [await flow.boundingBox(), await chip.boundingBox()];
			expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(flowBox!.y + flowBox!.height);
			expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(flowBox!.x + flowBox!.width + 1);
			expect(flowBox!.height).toBeLessThanOrEqual(2 * lineHeight);
		}
	}
	expect((await long.locator('.flow').boundingBox())!.height).toBe(2 * lineHeight);
	expect((await short.locator('.flow').boundingBox())!.height).toBe(lineHeight);
});
