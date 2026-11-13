import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

/** Whether the meta shares the title's line, and whether the date leads or trails the other meta. */
async function shape(row: Locator, repeats = true) {
	return row.locator('[data-row-text] > :last-child').evaluate((text, repeats) => {
		const box = (selector: string) => text.querySelector(selector)!.getBoundingClientRect();
		const title = box('[data-row-title]');
		const meta = box('[data-row-meta]');
		const due = box('[data-row-meta] .due');
		const oneLine = meta.top < title.bottom;
		const rightAligned = Math.abs(meta.right - text.getBoundingClientRect().right) < 1 && due.right > meta.right - 1;
		if (!repeats) return { oneLine, rightAligned };
		const repeat = box('[data-row-meta] [aria-label^="Repeats"]');
		return {
			oneLine,
			date: due.left > repeat.left ? 'last' : 'first',
			rightAligned,
		};
	}, repeats);
}

test('a row puts its title and meta on one line when they fit, date last, and wraps with the date first', async ({
	app,
	page,
}) => {
	await app.createProject('Birthdays');
	const long = 'Bday: Dan, and remember to order the cake from the bakery down the street a day early';
	await app.add('Bday: Dan jan 12 11am every year remind me 1h before', `${long} jan 12 11am every year`);

	await expect.poll(() => shape(app.row('Bday: Dan'))).toEqual({ oneLine: true, date: 'last', rightAligned: true });
	await expect.poll(() => shape(app.row(long))).toMatchObject({ oneLine: false, date: 'first' });
	await page.screenshot({ path: 'test-results/task-rows/desktop.png' });

	await app.add('Bday: Mia');
	await app.row('Bday: Mia').getByRole('button', { name: 'Postpone Bday: Mia' }).click();
	await page
		.getByRole('dialog', { name: 'Postpone Bday: Mia' })
		.getByRole('button', { name: 'Tomorrow', exact: true })
		.click();
	await expect.poll(() => shape(app.row('Bday: Mia'), false)).toEqual({ oneLine: true, rightAligned: true });

	await page.setViewportSize({ width: 393, height: 852 });
	await expect.poll(() => shape(app.row('Bday: Dan'))).toEqual({ oneLine: true, date: 'last', rightAligned: true });
	await page.setViewportSize({ width: 240, height: 852 });
	await expect.poll(() => shape(app.row('Bday: Dan'))).toMatchObject({ oneLine: false, date: 'first' });
	await page.setViewportSize({ width: 393, height: 852 });
	await expect.poll(() => shape(app.row('Bday: Dan'))).toMatchObject({ oneLine: true, date: 'last' });
	await page.screenshot({ path: 'test-results/task-rows/phone.png' });
});
