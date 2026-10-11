import { expect, test } from './fixtures.ts';

/**
 * The web half of the native notification rows, through the Notifications sheet. Web Push comes from the server, so
 * these pages pair with sync first and stand in for the browser's push service (`mockPush`). The dev server runs on
 * the real clock, so tests that read its schedule pin the browser two days ahead of it, at 10:00 UTC. Pairing pulls
 * every task on the server's shared account, so the schedule is checked per title rather than by the sheet's count.
 */
test.describe.configure({ timeout: 90_000 });

const real = new Date();
const TODAY = Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate() + 2);
const todayAt = (hh: number, mm = 0) => new Date(TODAY + (hh * 60 + mm) * 60_000);

/** Every test that syncs shares the server's one account, so titles carry a random suffix. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

// The app's real service worker would take over the page's requests from the push stand-ins and the routes.
test.use({ serviceWorkers: 'block' });

test('push-sheet: the Notifications sheet shows Off and offers to turn on', async ({ app, snap }) => {
	await app.mockPush('granted');
	await app.setUpSync();
	await app.expectNotificationsStatus('Off');
	await app.openNotifications('Get notified when tasks are due');
	await expect(app.notifications().getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
	await snap('push-sheet');
	await app.notifications().getByRole('button', { name: 'Not now' }).tap();
	await expect(app.notifications()).toBeHidden();
});

test('push-permission: asks only from Turn on notifications, and a denial says how to unblock', async ({
	app,
	page,
	snap,
}) => {
	await app.mockPush('granted');
	await app.add('Call mom today 10:30am');
	expect(await page.evaluate(() => Notification.permission)).toBe('default');
	await app.setUpSync();
	await app.openNotifications('Get notified when tasks are due');
	await app.notifications().getByRole('button', { name: 'Turn on notifications' }).tap();
	await expect(app.notifications().getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
	await app.closeNotifications();
	await app.expectNotificationsStatus('On');

	await app.mockPush('denied');
	await app.openNotifications('Get notified when tasks are due');
	await app.notifications().getByRole('button', { name: 'Turn on notifications' }).tap();
	await expect(app.notifications().getByRole('heading', { name: 'Notifications are blocked' })).toBeVisible();
	await expect(app.notifications()).toContainText('Settings › Notifications › Procrastimate');
	await snap('push-permission');
	await app.closeNotifications();
	await app.expectNotificationsStatus('Blocked');
});

test('push-schedule: the schedule is the future due times and reminders of open tasks', async ({ app, snap }) => {
	await app.setNow(todayAt(10));
	await app.mockPush('granted');
	await app.setUpSync();
	await app.openNotifications('Get notified when tasks are due');
	await app.notifications().getByRole('button', { name: 'Turn on notifications' }).tap();
	await expect(app.notifications().getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
	await app.closeNotifications();
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
	await app.openNotifications('Notifications are on');
	await snap('push-schedule');
});

test('push-deliver: one notification per moment, titled with the task', async ({ app, snap }) => {
	await app.setNow(todayAt(10));
	await app.mockPush('granted');
	await app.setUpSync();
	await app.openNotifications('Get notified when tasks are due');
	await app.notifications().getByRole('button', { name: 'Turn on notifications' }).tap();
	await expect(app.notifications().getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
	await app.closeNotifications();
	const standup = unique('Standup');
	await app.add(`${standup} today 10:45am remind me at 10:45am`);
	await expect
		.poll(() => app.serverSchedule(standup))
		.toEqual([`${standup}@${todayAt(10, 45).toISOString()}: Due now`]);
	await app.openNotifications('Notifications are on');
	await snap('push-deliver');
});

test('push-test: Send a test notification, then Turn off', async ({ app, snap }) => {
	await app.mockPush('granted');
	await app.setUpSync();
	await app.openNotifications('Get notified when tasks are due');
	await app.notifications().getByRole('button', { name: 'Turn on notifications' }).tap();
	await app.notifications().getByRole('button', { name: 'Send a test notification' }).tap();
	await expect(app.notifications().getByRole('button', { name: 'Sent' })).toBeVisible();
	await snap('push-test');
	await app.notifications().getByRole('button', { name: 'Turn off' }).tap();
	await expect(app.notifications().getByRole('heading', { name: 'Get notified when tasks are due' })).toBeVisible();
	await app.closeNotifications();
	await app.expectNotificationsStatus('Off');
});

test('push-nudge: the first timed task offers notifications once', async ({ app, page, snap }) => {
	const nudge = page.getByRole('status').filter({ hasText: 'Get notified when it’s due?' });
	await app.add('Buy milk');
	await expect(nudge).toHaveCount(0);
	await app.add('Call mom today 10:30am');
	await expect(nudge).toBeVisible();
	await snap('push-nudge');
	await nudge.getByRole('button', { name: 'Turn on' }).tap();
	await expect(app.notifications()).toBeVisible();
	await app.closeNotifications();
	await expect(nudge).toHaveCount(0);
	await app.add('Gym today 6pm');
	await expect(app.row('Gym')).toBeVisible();
	await expect(nudge).toHaveCount(0);
});

test('push-open: a notification opens its task', async ({ app, page, snap }) => {
	await app.add('Call mom today 10:30am');
	const id = await page.evaluate(() => JSON.parse(localStorage.getItem('procrastimate')!).tasks[0].id as string);
	await page.goto(`/today?task=${id}`);
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call mom');
	await snap('push-open');
});
