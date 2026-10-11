import { expect, test } from './fixtures.ts';

/**
 * The web half of the native notification rows. Permission is asked on first load. Settings has one line.
 * Web Push comes from the server, so these pages stand in for the browser's push service (`mockPush`). The dev
 * server runs on the real clock, so tests that read its schedule pin the browser two days ahead of it, at 10:00 UTC.
 */
test.describe.configure({ timeout: 90_000 });

const real = new Date();
const TODAY = Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate() + 2);
const todayAt = (hh: number, mm = 0) => new Date(TODAY + (hh * 60 + mm) * 60_000);

/** Every test that syncs shares the server's one account, so titles carry a random suffix. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

test.use({ serviceWorkers: 'block' });

test('push-sheet: settings shows notifications on once permission is granted', async ({ app, snap }) => {
	await app.mockPush('granted');
	await app.setUpSync();
	await app.expectNotificationLine('Notifications: On');
	await snap('push-sheet');
	await app.closeSettings();
});

test('push-permission: a denial is one tappable line', async ({ app, snap }) => {
	await app.mockPush('denied');
	await app.setUpSync();
	await app.expectNotificationLine('Notifications need permission');
	await snap('push-permission');
	await app.settings().getByRole('button', { name: 'Notifications need permission' }).tap();
	await expect(app.settings().getByRole('button', { name: 'Notifications need permission' })).toBeVisible();
	await app.closeSettings();
});

test('push-schedule: the schedule is the future due times and reminders of open tasks', async ({ app }) => {
	await app.setNow(todayAt(10));
	await app.mockPush('granted');
	await app.setUpSync();
	await app.expectNotificationLine('Notifications: On');
	await app.closeSettings();
	const [call, gym, done] = [unique('Call mom'), unique('Gym'), unique('Done')];
	await app.add(`${call} today 10:30am r20m`, 'Taxes today', `${gym} tomorrow 6pm`, `${done} today 11am`);
	await app.checkbox(done).tap();
	await expect(app.row(done)).toHaveCount(0);
	await expect
		.poll(() => app.serverSchedule(call))
		.toEqual([
			`${call}@${todayAt(10, 10).toISOString()}: Due at 10:30 AM`,
			`${call}@${todayAt(10, 30).toISOString()}: Due now`,
		]);
	await expect.poll(() => app.serverSchedule(gym)).toEqual([`${gym}@${todayAt(24 + 18).toISOString()}: Due now`]);
	await expect.poll(() => app.serverSchedule(done)).toEqual([]);
});

test('push-deliver: one notification per moment, titled with the task', async ({ app }) => {
	await app.setNow(todayAt(10));
	await app.mockPush('granted');
	await app.setUpSync();
	await app.expectNotificationLine('Notifications: On');
	await app.closeSettings();
	const standup = unique('Standup');
	await app.add(`${standup} today 10:45am remind me at 10:45am`);
	await expect
		.poll(() => app.serverSchedule(standup))
		.toEqual([`${standup}@${todayAt(10, 45).toISOString()}: Due now`]);
});

test('push-test: settings has the notifications line and no turn-on prompt', async ({ app, snap }) => {
	await app.mockPush('granted');
	await app.setUpSync();
	await app.expectNotificationLine('Notifications: On');
	await expect(app.settings().getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
	await expect(app.settings().getByRole('button', { name: 'Send a test notification' })).toHaveCount(0);
	await expect(app.settings().getByRole('button', { name: 'Turn off' })).toHaveCount(0);
	await snap('push-test');
	await app.closeSettings();
});

test('push-nudge: a timed task does not offer to turn notifications on', async ({ app, page }) => {
	const nudge = page.getByRole('status').filter({ hasText: 'Get notified when it’s due?' });
	await app.add('Buy milk');
	await app.add('Call mom today 10:30am');
	await expect(app.row('Call mom')).toBeVisible();
	await expect(nudge).toHaveCount(0);
});

test('push-open: a notification opens its task', async ({ app, page, snap }) => {
	await app.add('Call mom today 10:30am');
	const id = await page.evaluate(() => JSON.parse(localStorage.getItem('procrastimate')!).tasks[0].id as string);
	await page.goto(`/today?task=${id}`);
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call mom');
	await snap('push-open');
});
