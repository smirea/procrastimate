import { expect, test } from './fixtures';

test(
	'a production task URL in task text opens that task in place, in a row and in details’ notes',
	{ tag: '@webkit' },
	async ({ app, page, context }) => {
		await app.add('Pay rent');
		const rent = await app.taskId('Pay rent');
		const source = `See https://procrastimate.stf.lol/inbox?task=${rent}`;
		await app.add(source);
		const tabs = context.pages().length;

		await app.row(source).getByRole('link').click();
		const details = app.details();
		await expect(details.getByRole('textbox', { name: 'Title' })).toHaveValue('Pay rent');
		expect(context.pages()).toHaveLength(tabs);

		const back = `https://procrastimate.stf.lol/today?task=${await app.taskId(source)}`;
		await details.getByRole('textbox', { name: 'Notes' }).fill(`From ${back}`);
		await details.getByRole('textbox', { name: 'Title' }).focus();
		await details.getByRole('link', { name: back }).click();
		await expect(details.getByRole('textbox', { name: 'Title' })).toHaveValue(source);
		expect(context.pages()).toHaveLength(tabs);
		await app.settle();
		await page.screenshot({
			path: `test-results/task-links/details-${test.info().project.name}.png`,
		});
	},
);

test('a task URL this account cannot see says so instead of opening a tab', async ({ app, page, context }) => {
	await app.add('Ask https://procrastimate.stf.lol/inbox?task=gone');
	const tabs = context.pages().length;
	await app.row('Ask https://procrastimate.stf.lol/inbox?task=gone').getByRole('link').click();
	await expect(page.getByRole('status').filter({ hasText: 'Can’t find that task' })).toBeVisible();
	expect(context.pages()).toHaveLength(tabs);
});

test('a task URL on a public link’s page opens in a new tab, even signed in', async ({ app, page, context }) => {
	await app.add('Pay rent');
	const source = `See https://procrastimate.stf.lol/inbox?task=${await app.taskId('Pay rent')}`;
	await app.add(source);
	await app
		.row(source)
		.getByRole('button', { name: /^See/ })
		.click({ position: { x: 24, y: 12 } });
	await app.details().getByRole('button', { name: 'Share' }).click();
	const sheet = page.getByRole('dialog', { name: 'Share' });
	await sheet.getByRole('button', { name: 'Copy link' }).click();
	const link = sheet.getByLabel('Link');
	await expect(link).toHaveText(/\/s\/.+/);
	await page.goto(new URL((await link.textContent())!).pathname);

	const shared = page.getByRole('link', { name: /task=/ }).first();
	await expect(shared).toBeVisible({ timeout: 15_000 });
	await context.route('https://procrastimate.stf.lol/**', route => route.fulfill({ body: 'production' }));
	const [tab] = await Promise.all([context.waitForEvent('page'), shared.click()]);
	expect(tab.url()).toContain('task=');
});
