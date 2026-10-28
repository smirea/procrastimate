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
