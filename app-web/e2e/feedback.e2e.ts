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

test('the GitHub Issue entry shows only for the account the server allows, and posts the image and report', async ({
	app,
	page,
}) => {
	const title = unique('Oat milk');
	await app.add(title);
	const share = async () => {
		await app
			.row(title)
			.getByRole('button', { name: title, exact: true })
			.click({ modifiers: ['Alt', 'Meta'] });
		await editor(page).waitFor();
		await field(page).fill('Row is too tall');
		await field(page).press('Enter');
		await page.getByRole('button', { name: 'Share' }).click();
		await page.getByRole('menuitem', { name: 'ProcrastiMate' }).waitFor();
	};

	// The suite's server names no account for issues, so this one is refused the entry.
	await share();
	await expect(page.getByRole('menuitem', { name: 'GitHub Issue' })).toHaveCount(0);
	await page.keyboard.press('Escape');

	await page.route('**/api/feedback/github', route => route.fulfill({ json: { enabled: true } }));
	let posted: { parts: string[]; cookie: boolean } | undefined;
	await page.route('**/api/feedback/issues', async route => {
		const body = route.request().postDataBuffer()?.toString('latin1') ?? '';
		posted = {
			parts: [...body.matchAll(/name="(\w+)"/g)].map(match => match[1]!),
			cookie: !!(await route.request().headerValue('cookie')),
		};
		await route.fulfill({ status: 201, json: { url: 'https://github.com/smirea/procrastimate/issues/1' } });
	});
	await app.reload();
	await share();
	await page.getByRole('menuitem', { name: 'GitHub Issue' }).click();
	await expect(page.locator('.toast')).toContainText('Sent to GitHub Issue', { timeout: 15_000 });
	expect(posted).toEqual({ parts: ['id', 'title', 'image', 'report'], cookie: true });
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

test.describe('phone', () => {
	test.use({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });

	test('a three-finger hold opens Feedback, even with a finger on a row, and a quick three-finger tap does not', async ({
		app,
		page,
	}) => {
		const title = unique('Oat milk');
		await app.add(title);
		const cdp = await page.context().newCDPSession(page);
		const box = (await app.row(title).boundingBox())!;
		const onRow = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
		const fingers = [onRow, { x: 120, y: 500, id: 2 }, { x: 260, y: 500, id: 3 }];
		const touch = (type: 'touchStart' | 'touchEnd', touchPoints: typeof fingers) =>
			cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

		await touch('touchStart', fingers);
		await page.waitForTimeout(150);
		await touch('touchEnd', []);
		await page.waitForTimeout(900);
		await expect(editor(page)).toBeHidden();

		// The first finger lands on the row alone, as a real hand's does, and the row menu's own hold must stand down.
		await touch('touchStart', [onRow]);
		await touch('touchStart', fingers);
		await editor(page).waitFor({ timeout: 5000 });
		await touch('touchEnd', []);
		await expect(page.getByRole('menu', { name: title })).toHaveCount(0);
		await expect(app.details()).toBeHidden();
		await page.getByRole('button', { name: 'Close' }).tap();
		await expect(editor(page)).toBeHidden();
	});
});
