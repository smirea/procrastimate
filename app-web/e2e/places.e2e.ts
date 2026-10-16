import { expect, test } from './fixtures';

test('task details show a place with the radius iOS watches', async ({ app }) => {
	await app.add('Walk the loop');
	await app.pushFromOtherDevice({
		kind: 'task',
		id: await app.taskId('Walk the loop'),
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
	});

	await app.row('Walk the loop').getByRole('button', { name: 'Walk the loop', exact: true }).click();
	await expect(app.details().getByText('While at Tiergarten 1.5 km')).toBeVisible();
});
