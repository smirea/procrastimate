import { task } from '../../shared/testing.ts';
import { expect, NOW, test } from './fixtures.ts';

const today = { date: '2026-10-14', time: null } as const;

test('a dated subtask shows in Today only while its parent does not, and a completed parent sets it aside', async ({
	app,
	page,
}) => {
	const [move, errands] = [crypto.randomUUID(), crypto.randomUUID()];
	let createdAt = NOW.getTime();
	const row = (title: string, fields: Parameters<typeof task>[1] = {}) => ({
		kind: 'task' as const,
		fields: task(fields.id ?? crypto.randomUUID(), { title, createdAt: createdAt++, ...fields }),
	});
	await app.seed(
		row('Move', { id: move, due: today }),
		row('Book van', { parentId: move, due: today }),
		row('Errands', { id: errands }),
		row('Buy milk', { parentId: errands, due: today }),
	);
	await app.go('Inbox');
	const todayRows = page.getByRole('region', { name: 'Today' }).locator('[data-task]');
	const inboxCount = app.nav('Inbox').locator('span.text-faint');
	await expect(todayRows).toHaveText([/Move/, /Buy milk/]);
	await expect(todayRows.filter({ hasText: 'Buy milk' })).toContainText('Errands');
	await expect(app.row('Move').getByRole('img', { name: '0 of 1 subtasks done' })).toBeVisible();
	await expect(inboxCount).toHaveText('2');
	await app.settle();
	await page.screenshot({ path: 'test-results/subtask-visibility/today.png' });

	await app.pushFromOtherDevice({ kind: 'task', id: errands, fields: { completedAt: NOW.getTime() } });
	await expect(todayRows).toHaveText([/Move/]);
	await expect(inboxCount).toHaveText('1');

	await app.pushFromOtherDevice({ kind: 'task', id: errands, fields: { completedAt: null } });
	await expect(todayRows).toHaveText([/Move/, /Buy milk/]);
	await expect(inboxCount).toHaveText('2');

	await app.row('Move').getByRole('checkbox', { name: 'Complete Move', exact: true }).click();
	await expect(todayRows).toHaveText([/Buy milk/]);
	await expect(inboxCount).toHaveText('1');
	await app.settle();
	await page.screenshot({ path: 'test-results/subtask-visibility/parent-completed.png' });
});

test('a filter that hides a parent lets its dated subtask show alone, and search draws a subtask under a completed parent as done', async ({
	app,
	page,
}) => {
	const [move, trip] = [crypto.randomUUID(), crypto.randomUUID()];
	let createdAt = NOW.getTime();
	const row = (title: string, fields: Parameters<typeof task>[1] = {}) => ({
		kind: 'task' as const,
		fields: task(fields.id ?? crypto.randomUUID(), { title, createdAt: createdAt++, ...fields }),
	});
	await app.seed(
		row('Move', { id: move, priority: 4, due: today }),
		row('Call movers', { parentId: move, priority: 1, due: today }),
		row('Pay rent', { priority: 1, due: today }),
		row('Trip', { id: trip, completedAt: NOW.getTime() - 86_400_000 }),
		row('Pack bags', { parentId: trip }),
	);
	await app.go('Inbox');
	const todayRows = page.getByRole('region', { name: 'Today' }).locator('[data-task]');
	await expect(todayRows).toHaveText([/Pay rent/, /Move/]);

	await page.getByRole('button', { name: 'Filters', exact: true }).click();
	const menu = page.getByRole('dialog', { name: 'Filters' });
	await menu.getByRole('menuitemcheckbox', { name: /Priority 1/ }).click();
	await expect(todayRows).toHaveText([/Call movers/, /Pay rent/]);
	await expect(todayRows.filter({ hasText: 'Call movers' })).toContainText('Move');
	await expect(menu.getByRole('menuitemcheckbox', { name: /Priority 1/ })).toHaveText(/Priority 1\s*2/);
	await page.keyboard.press('Escape');
	await app.settle();
	await page.screenshot({ path: 'test-results/subtask-visibility/filtered.png' });

	await page.keyboard.press('/');
	const search = page.getByRole('dialog', { name: 'Search' });
	await search.getByRole('combobox', { name: 'Search' }).fill('pack');
	const result = search.getByRole('option').filter({ hasText: 'Pack bags' });
	await expect(search.getByRole('group')).toHaveText([/^Completed/]);
	await expect(result.locator('.status.done')).toHaveCount(1);
	await expect(result).toContainText('Completed');
	await app.settle();
	await page.screenshot({ path: 'test-results/subtask-visibility/search.png' });

	await result.click({ button: 'right' });
	const rowMenu = page.getByRole('menu', { name: 'Pack bags' });
	await expect(rowMenu.getByRole('menuitem', { name: 'Complete' })).toHaveCount(0);
	await rowMenu.getByRole('menuitem', { name: 'Reopen' }).click();
	await expect(search.getByRole('group')).toHaveText([/^Tasks/]);
	await expect(search.getByRole('option').filter({ hasText: 'Pack bags' }).locator('.status.done')).toHaveCount(0);
});
