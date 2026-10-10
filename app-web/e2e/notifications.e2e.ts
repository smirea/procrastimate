import { expect, NOW, test } from './fixtures.ts';

const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

test('a due time notifies on its own, reminders add to it, and a date alone never notifies', async ({ app, page }) => {
	const toast = (title: string) => page.getByRole('status').filter({ hasText: `Reminder: ${title}` });
	await app.add(
		'Call mom today 10:30am',
		'Taxes today',
		'Standup today 10:45am remind me at 10:45am',
		'Gym today 11am remind me 30m before',
	);

	await app.setNow(minutes(31));
	await page.reload();
	await expect(toast('Call mom')).toBeVisible();
	await expect(toast('Gym')).toBeVisible();
	await expect(toast('Standup')).toHaveCount(0);
	await expect(toast('Taxes')).toHaveCount(0);

	await app.setNow(minutes(46));
	await page.reload();
	await expect(toast('Standup')).toHaveCount(1);
	await expect(toast('Call mom')).toHaveCount(0);

	await app.setNow(minutes(61));
	await page.reload();
	await expect(toast('Gym')).toHaveCount(1);
	await expect(toast('Standup')).toHaveCount(0);
	await expect(toast('Taxes')).toHaveCount(0);
});
