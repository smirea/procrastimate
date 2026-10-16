import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';

test('task details show a place with the radius iOS watches', async ({ app, page }) => {
	await app.add('Walk the loop');
	await expect
		.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('procrastimate')!).sync.outbox.length))
		.toBe(0);
	const id = await page.evaluate(
		() =>
			JSON.parse(localStorage.getItem('procrastimate')!).tasks.find(
				(task: { title: string }) => task.title === 'Walk the loop',
			).id,
	);
	const device = randomUUID();
	const response = await page.request.post('/api/sync', {
		headers: { 'x-procrastimate-device': device },
		data: {
			cursor: 0,
			ops: [
				{
					kind: 'task',
					id,
					fields: {
						location: {
							name: 'Tiergarten',
							address: 'Berlin',
							latitude: 52.5145,
							longitude: 13.3501,
							radius: 1480,
							trigger: 'during',
						},
					},
					opId: randomUUID(),
					hlc: `${Date.now() + 60_000}:0:${device}`,
				},
			],
		},
	});
	expect(response.status()).toBe(200);
	expect((await response.json()).rejected ?? []).toEqual([]);
	await page.reload();

	await app.row('Walk the loop').getByRole('button', { name: 'Walk the loop', exact: true }).click();
	await expect(app.details().getByText('While at Tiergarten 1.5 km')).toBeVisible();
});
