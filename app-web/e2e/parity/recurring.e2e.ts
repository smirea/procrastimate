import { expect, test } from './fixtures.ts';

test('recurring-display: the repeat icon is named after the repeat', async ({ app, snap }) => {
	await app.add('Standup every mon 9am', 'Water plants every 3 days');
	await expect(app.row('Standup').getByRole('img', { name: 'Repeats every Mon' })).toBeVisible();
	await expect(app.row('Water plants').getByRole('img', { name: 'Repeats every 3 days' })).toBeVisible();
	await snap('recurring-display');
});
