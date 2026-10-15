import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';

test('a task from Talkward shows its waveform and a Talkward line without a link', async ({ app, page }) => {
	await app.add('Typed by hand');
	const response = await page.request.put('/api/memo-tasks', {
		headers: { 'x-procrastimate-device': randomUUID(), 'x-procrastimate-device-name': 'Talkward' },
		data: {
			memoId: '0b7c1f9e-6a59-4f0e-9d7e-3c2a1b0f9e8d',
			recordedAt: Date.parse('2026-10-14T09:00:00Z'),
			tasks: [{ key: randomUUID(), title: 'Call the plumber', notes: '', when: null, event: null }],
		},
	});
	expect(response.status()).toBe(200);

	await app.nav('No date').click();
	const memoRow = app.row('Call the plumber');
	await expect(memoRow.getByRole('img', { name: 'From Talkward' })).toBeVisible();
	await expect(app.row('Typed by hand').getByRole('img', { name: 'From Talkward' })).toHaveCount(0);

	await memoRow.getByRole('button', { name: /^Call the plumber/ }).click();
	await expect(app.details().getByText('Talkward', { exact: true })).toBeVisible();
	await expect(app.details().getByRole('link', { name: 'Talkward' })).toHaveCount(0);
});
