import { expect, test } from './fixtures';

test('dragging a subtask by its handle past a taller row reorders it, and the arrow keys move it back', async ({
	app,
	page,
}) => {
	const long = 'Book the airport transfer and confirm the pickup details with the hotel concierge so nothing is missed';
	await app.add('Pack for trip');
	await app.row('Pack for trip').getByRole('button', { name: 'Pack for trip', exact: true }).click();
	const add = app.details().getByRole('textbox', { name: 'Add subtask' });
	for (const title of ['Passport', 'Socks', long, 'Charger']) {
		await add.fill(title);
		await add.press('Enter');
	}
	const rows = app.details().getByRole('list', { name: 'Subtasks of Pack for trip' }).locator('[data-subtask]');
	const titles = () => rows.evaluateAll(items => items.map(item => item.getAttribute('data-subtask')));
	await expect.poll(titles).toEqual(['Passport', 'Socks', long, 'Charger']);
	await app.settle();
	const heights = await rows.evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
	expect(heights[2]).toBeGreaterThan(heights[0]! * 1.5);

	const handle = (await page.getByRole('button', { name: 'Reorder Charger' }).boundingBox())!;
	const first = (await rows.first().boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, first.y - 40, { steps: 16 });
	await page.mouse.up();
	await expect.poll(titles).toEqual(['Charger', 'Passport', 'Socks', long]);

	await page.getByRole('button', { name: 'Reorder Charger' }).press('ArrowDown');
	await expect.poll(titles).toEqual(['Passport', 'Charger', 'Socks', long]);
	await expect(page.getByRole('button', { name: 'Reorder Charger' })).toBeFocused();
});
