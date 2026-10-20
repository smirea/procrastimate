import { expect, test } from './fixtures.ts';

test('every list has the same menus, and filters narrow it by who made a task and its priority', async ({
	app,
	page,
	playwright,
}) => {
	const ai = await (await page.request.post('/api/ai', { data: { name: 'Robo' } })).json();
	const { token } = await (
		await page.request.post('/api/ai-tokens', { data: { aiUserId: ai.id, name: 'e2e' } })
	).json();
	const agent = await playwright.request.newContext({
		baseURL: new URL(page.url()).origin,
		extraHTTPHeaders: { authorization: `Bearer ${token}` },
	});
	for (const text of ['Water plants p2', 'Book flights'])
		expect((await agent.post('/api/tasks', { data: { text } })).ok()).toBe(true);
	await agent.dispose();
	await app.go('No date');
	await app.add('Buy milk p1', 'Call mom');

	await expect(app.row('Water plants')).toContainText(/by\s*Robo\s*AI/, { timeout: 10_000 });
	await expect(app.row('Buy milk')).not.toContainText('by');

	await expect((await app.listMenu()).locator('button')).toHaveText([
		'Copy as Markdown',
		'Newest first',
		'Oldest first',
	]);
	await page.keyboard.press('Escape');

	const filters = page.getByRole('button', { name: 'Filters', exact: true });
	const menu = page.getByRole('dialog', { name: 'Filters' });
	await expect(filters).toHaveAttribute('aria-pressed', 'false');
	await filters.click();
	await expect(menu.getByRole('group', { name: 'Created by' }).getByRole('menuitemcheckbox')).toHaveText([
		'Created by',
		/You\s*2/,
		/Robo\s*AI\s*2/,
	]);
	await expect(menu.getByRole('group', { name: 'Priority' }).getByRole('menuitemcheckbox')).toHaveText([
		'Priority',
		/Priority 1\s*1/,
		/Priority 2\s*1/,
		/Priority 4\s*2/,
	]);

	await menu.getByRole('menuitemcheckbox', { name: 'Created by' }).click();
	await expect(menu.getByRole('menuitemcheckbox', { checked: true })).toHaveText(['Created by', /You/, /Robo/]);
	await expect(filters).toHaveAttribute('aria-pressed', 'true');
	await menu.getByRole('menuitemcheckbox', { name: /Robo/ }).click();
	await expect(app.list('Tasks without a date').locator('[data-task]')).toHaveText([/Call mom/, /Buy milk/]);
	await expect(menu.getByRole('group', { name: 'Priority' }).getByRole('menuitemcheckbox')).toHaveText([
		'Priority',
		/Priority 1\s*1/,
		/Priority 4\s*1/,
	]);
	await menu.getByRole('menuitemcheckbox', { name: /Priority 1/ }).click();
	await expect(app.list('Tasks without a date').locator('[data-task]')).toHaveText([/Buy milk/]);
	await app.settle();
	await page.screenshot({ path: 'test-results/list-header/filters.png' });

	await app.reload();
	await expect(app.list('Tasks without a date').locator('[data-task]')).toHaveText([/Buy milk/]);
	await expect(filters).toHaveAttribute('aria-pressed', 'true');
	await app.go('Inbox');
	await expect(filters).toHaveCount(0);
	await app.go('No date');
	await filters.click();
	await menu.getByRole('button', { name: 'Clear filters' }).click();
	await expect(app.list('Tasks without a date').locator('[data-task]')).toHaveCount(4);
	await expect(filters).toHaveAttribute('aria-pressed', 'false');
});

test('a project’s menu leads with what every list shares, then its own entries', async ({ app, page }) => {
	await app.createProject('Home');
	const menu = await app.listMenu();
	await expect(menu.locator('button:not([role="radio"])')).toHaveText([
		'Share',
		'Copy as Markdown',
		'Show completed',
		'Add section',
		'Rename',
		'Delete project',
	]);
	await expect(menu.getByRole('separator')).toHaveCount(1);
	await app.settle();
	await page.screenshot({ path: 'test-results/list-header/project-menu.png' });
});
