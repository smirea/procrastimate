import type { Locator } from '@playwright/test';
import { task } from '../../shared/testing.ts';
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

/** Whether the meta shares the line above it, a notes or subtask preview here, and sits at the row's right. */
async function lastLine(row: Locator) {
	return row.locator('[data-row-meta]').evaluate(meta => {
		const box = meta.getBoundingClientRect();
		const last = meta.previousElementSibling!.getBoundingClientRect();
		const text = meta.parentElement!.getBoundingClientRect();
		return { inline: box.top < last.bottom, rightAligned: Math.abs(box.right - text.right) < 1 };
	});
}

test('meta sits at the right of the last notes or subtask line when it fits there, and on its own line when not', async ({
	app,
	page,
}) => {
	const [food, lease] = [crypto.randomUUID(), crypto.randomUUID()];
	const notes = 'Ask about late checkout, and whether the shuttle runs on Sundays before the museum opens at ten';
	await app.seed(
		{ kind: 'task', fields: task(food, { title: 'Food Ideas:', createdAt: 1 }) },
		{ kind: 'task', fields: task(crypto.randomUUID(), { title: 'natto', parentId: food, createdAt: 2 }) },
		{ kind: 'task', fields: task(lease, { title: 'Read the lease', notes, createdAt: 3 }) },
		{
			kind: 'task',
			fields: task(crypto.randomUUID(), { title: 'Sign it', parentId: lease, completedAt: 4, createdAt: 4 }),
		},
	);
	await app.go('No date');
	const foodRow = app.row('Food Ideas:');
	const leaseRow = app.row('Read the lease');
	await expect(foodRow.getByRole('list', { name: 'Open subtasks' })).toHaveText(/natto/);
	await expect(leaseRow.getByText(notes.slice(0, 20))).toBeVisible();

	await expect.poll(() => lastLine(foodRow)).toEqual({ inline: true, rightAligned: true });
	await expect.poll(() => lastLine(leaseRow)).toEqual({ inline: true, rightAligned: true });
	await app.settle();
	await page.screenshot({ path: 'test-results/task-rows/last-line-desktop.png' });

	await page.setViewportSize({ width: 393, height: 852 });
	await expect.poll(() => lastLine(foodRow)).toEqual({ inline: true, rightAligned: true });
	await expect.poll(() => lastLine(leaseRow)).toEqual({ inline: true, rightAligned: true });
	await app.settle();
	await page.screenshot({ path: 'test-results/task-rows/last-line-phone.png' });

	await page.setViewportSize({ width: 200, height: 852 });
	await expect.poll(() => lastLine(leaseRow)).toMatchObject({ inline: false });
});
