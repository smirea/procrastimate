import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

const LONG =
	'Call the plumber about the leaking kitchen sink and ask whether they can also look at the bathroom tap and the radiator in the hallway before guests arrive';

const box = (field: Locator) =>
	field.evaluate(el => ({
		height: el.clientHeight,
		content: el.scrollHeight,
		lineHeight: parseFloat(getComputedStyle(el).lineHeight),
	}));

test('title, notes, and subtask fields grow with their text instead of cutting it off', async ({ app, page }) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await page.getByRole('button', { name: 'Quick add' }).click();
	const taskName = app.taskInput();
	const empty = await box(taskName);
	expect(empty.height).toBeLessThan(empty.lineHeight * 1.5);

	// A pasted line break joins the lines, since the field is one line that wraps.
	await taskName.fill(`${LONG}\nsecond line`);
	await expect(taskName).toHaveValue(`${LONG} second line`);
	const typed = await box(taskName);
	expect(typed.height).toBeGreaterThan(typed.lineHeight * 2.5);
	expect(typed.content).toBeLessThanOrEqual(typed.height + 1);
	await taskName.press('Enter');
	await expect(app.quickAdd()).toBeHidden();

	await app
		.row(`${LONG} second line`)
		.getByRole('button', { name: /^Call the plumber/ })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	const titleBox = await box(title);
	expect(titleBox.height).toBeGreaterThan(titleBox.lineHeight * 2.5);
	expect(titleBox.content).toBeLessThanOrEqual(titleBox.height + 1);

	const notes = app.details().getByRole('textbox', { name: 'Notes' });
	await notes.fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join('\n'));
	const notesBox = await box(notes);
	expect(notesBox.height).toBeGreaterThan(notesBox.lineHeight * 11);
	expect(notesBox.content).toBeLessThanOrEqual(notesBox.height + 1);

	const subtask = app.details().getByRole('textbox', { name: 'Add subtask' });
	await subtask.fill(LONG);
	const subtaskBox = await box(subtask);
	expect(subtaskBox.height).toBeGreaterThan(subtaskBox.lineHeight * 1.5);
	expect(subtaskBox.content).toBeLessThanOrEqual(subtaskBox.height + 1);

	// Past eight lines the field stops growing and scrolls.
	await subtask.fill(`${LONG} ${LONG} ${LONG} ${LONG}`);
	const capped = await box(subtask);
	expect(capped.height).toBeLessThanOrEqual(capped.lineHeight * 8 + 6);
	expect(capped.content).toBeGreaterThan(capped.height);
	await subtask.press('Enter');
	await expect(app.details().getByRole('button', { name: /^Call the plumber/ })).toHaveCount(1);
});

test('search opens with an empty query each time', async ({ app, page }) => {
	await app.add('Call the plumber');
	const search = page.getByRole('combobox', { name: 'Search' });
	await page.keyboard.press('/');
	await search.fill('plumber');
	await expect(page.getByRole('listbox', { name: 'Search results' }).getByRole('option')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(search).toBeHidden();
	await page.keyboard.press('/');
	await expect(search).toBeFocused();
	await expect(search).toHaveValue('');
});
