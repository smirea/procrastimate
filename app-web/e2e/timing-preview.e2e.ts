import { expect, test } from './fixtures.ts';

test('quick add previews the resolved timing above the input as you type', async ({ app, page }) => {
	await app.openQuickAdd();
	const preview = page.getByRole('status', { name: 'Timing preview' });
	await app.taskInput().pressSequentially('Standup');
	await expect(preview).toHaveCount(0);

	await app.taskInput().pressSequentially(' every mon 9am');
	await expect(preview).toHaveText('Mon Oct 19 at 9:00 AM · Repeats every Mon · Notifies at 9:00 AM');
	await app.taskInput().pressSequentially(' remind me 10m before');
	await expect(preview).toHaveText(
		'Mon Oct 19 at 9:00 AM · Repeats every Mon · Notifies at 9:00 AM · Remind 10 min before (8:50 AM)',
	);

	const box = (await preview.boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual((await app.taskInput().boundingBox())!.y);
	await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
	await page.screenshot({ path: 'test-results/timing-preview.png' });

	await app.taskInput().fill('Call mom tomorrow 5pm remind me 30m before');
	await expect(preview).toHaveText(
		'Tomorrow, Thu Oct 15 at 5:00 PM · Notifies at 5:00 PM · Remind 30 min before (4:30 PM)',
	);
	await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
	await page.screenshot({ path: 'test-results/timing-preview-notifies.png' });
	await app.taskInput().fill('Call mom tomorrow');
	await expect(preview).toHaveText('Tomorrow, Thu Oct 15');
	await app.taskInput().fill('Call mom');
	await expect(preview).toHaveCount(0);
});

test('the task details title previews timing until it is applied', async ({ app, page }) => {
	await app.add('Water plants');
	await app
		.row('Water plants')
		.getByRole('button', { name: /Water plants/ })
		.click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	const preview = page.getByRole('status', { name: 'Timing preview' });
	await title.click();
	await title.press('End');
	await title.pressSequentially(' fri 6pm');
	await expect(preview).toHaveText('Fri Oct 16 at 6:00 PM · Notifies at 6:00 PM');

	await title.press('Enter');
	await expect(preview).toHaveCount(0);
	await expect(app.details().getByRole('button', { name: 'Due Friday 6pm' })).toBeVisible();
});
