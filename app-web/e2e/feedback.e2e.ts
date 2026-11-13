import { expect, test, unique } from './fixtures.ts';

const editor = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Feedback', exact: true });
const field = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Feedback text' });

test('Alt+Meta+click on a row posts feedback on it to ProcrastiMate as a task with the image and report', async ({
	app,
	page,
}) => {
	const title = unique('Oat milk');
	await app.add(title);
	await app
		.row(title)
		.getByRole('button', { name: title, exact: true })
		.click({ modifiers: ['Alt', 'Meta'] });
	await editor(page).waitFor();
	await expect(page.locator('.selected')).toHaveText(`Text "${title}"`);
	await page.getByRole('button', { name: /^Select parent/ }).click();
	await expect(page.locator('.selected')).toHaveText('TaskRow');

	await field(page).fill('Row is too tall');
	await field(page).press('Enter');
	await page.getByRole('button', { name: 'Share' }).click();
	await page.getByRole('menuitem', { name: 'ProcrastiMate' }).click();
	const sheet = page.getByRole('form', { name: 'Add to ProcrastiMate' });
	await sheet.getByRole('option', { name: 'Inbox' }).waitFor();
	const name = unique('Feedback');
	await sheet.getByRole('textbox', { name: 'Task name' }).fill(name);
	await sheet.getByRole('button', { name: 'Add' }).click();
	await expect(page.locator('.toast')).toContainText('Added to Inbox in ProcrastiMate', { timeout: 15_000 });

	const view = (await (await page.request.get('/api/view')).json()) as {
		tasks: { title: string; projectId: string | null; attachments: { name?: string; width?: number }[] }[];
	};
	const posted = view.tasks.find(task => task.title === name);
	expect(posted?.projectId).toBeNull();
	expect(posted?.attachments.map(attachment => attachment.name ?? 'image')).toEqual(['image', 'feedback.json']);

	await page.getByRole('button', { name: 'Close' }).click();
	await expect(editor(page)).toBeHidden();
	await expect(app.row(name)).toBeVisible({ timeout: 10_000 });
});

test('Give feedback in Settings closes it and counts down to a capture', async ({ app, page }) => {
	await app.openSettings();
	await app.settings().getByRole('button', { name: 'Give feedback' }).click();
	await expect(app.settings()).toBeHidden();
	await expect(page.getByRole('button', { name: /^Feedback in \d/ })).toBeVisible();
	await editor(page).waitFor({ timeout: 10_000 });
	await expect(page.locator('.selected')).toHaveCount(0);
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(editor(page)).toBeHidden();
});
