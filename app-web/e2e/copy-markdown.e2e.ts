import { expect, test } from './fixtures.ts';

test('copies a task, a section, and a view as Markdown', async ({ app, page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
	const rent = ['- [ ] Pay rent · Today · p1 · #Work', '  - [ ] Find checkbook'];

	await app.createProject('Work');
	await app.go('Inbox');
	await app.add('Pay rent today #Work p1', 'Call mom tomorrow');

	await app.row('Pay rent').click();
	const subtask = app.details().getByPlaceholder('Add subtask');
	await subtask.fill('Find checkbook');
	await subtask.press('Enter');
	await app.details().getByRole('button', { name: 'Copy task as Markdown' }).click();
	await expect.poll(clipboard).toBe(rent.join('\n'));
	await expect(page.getByText('Copied as Markdown').first()).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('heading', { name: 'Today', level: 2 }).hover();
	await page.getByRole('button', { name: 'Copy Today as Markdown' }).click();
	await expect.poll(clipboard).toBe(['## Today', '', ...rent].join('\n'));

	await page.getByRole('button', { name: 'Copy Inbox as Markdown' }).click();
	await expect
		.poll(clipboard)
		.toBe(['# Inbox', '', '## Today', '', ...rent, '', '## Tomorrow', '', '- [ ] Call mom · Tomorrow'].join('\n'));

	await app.nav('Work').click();
	await page.getByRole('button', { name: 'Copy Work as Markdown' }).click();
	await expect.poll(clipboard).toBe(['# Work', '', '- [ ] Pay rent · Today · p1', '  - [ ] Find checkbook'].join('\n'));
});
