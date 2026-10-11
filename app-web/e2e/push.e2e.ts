import type { Page } from '@playwright/test';
import type { PushScheduleResponse } from 'shared/push.ts';
import { SYNC_SETUP_CODE } from '../playwright.config.ts';
import { expect, test, type App } from './fixtures.ts';

const serverKey = (seed: number) => Buffer.from(Array.from({ length: 65 }, (_, i) => i + seed)).toString('base64url');

/**
 * Stands in for the browser's push service. Playwright's Chromium contexts cannot subscribe for real, so
 * `PushManager` hands out a fake subscription bound to the key it was given, kept in `sessionStorage` so it survives
 * a reload. Each subscribe gets a new endpoint, and fails while `mock-push-down` is set. Subscriptions still register with the real server, which computes the
 * schedule from synced tasks. Returns a function that rotates the key the server serves.
 */
async function mockPush(page: Page, permission: 'grant' | 'deny') {
	let key = serverKey(0);
	await page.route('/api/push/key', route => route.fulfill({ json: { publicKey: key } }));
	await page.addInitScript(
		([endpointBase, outcome]) => {
			type Saved = { endpoint: string; key: number[] };
			const subscription = (saved: Saved) =>
				({
					endpoint: saved.endpoint,
					options: { applicationServerKey: Uint8Array.from(saved.key).buffer, userVisibleOnly: true },
					toJSON: () => ({ endpoint: saved.endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
					unsubscribe: async () => {
						sessionStorage.removeItem('mock-push');
						return true;
					},
				}) as unknown as PushSubscription;
			PushManager.prototype.getSubscription = async () => {
				const saved = sessionStorage.getItem('mock-push');
				return saved ? subscription(JSON.parse(saved) as Saved) : null;
			};
			PushManager.prototype.subscribe = async options => {
				if (sessionStorage.getItem('mock-push')) throw new DOMException('Already subscribed', 'InvalidStateError');
				if (sessionStorage.getItem('mock-push-down')) throw new DOMException('Push service unreachable', 'AbortError');
				const count = Number(sessionStorage.getItem('mock-push-count') ?? 0) + 1;
				sessionStorage.setItem('mock-push-count', String(count));
				const bytes = new Uint8Array(options!.applicationServerKey as Uint8Array<ArrayBuffer>);
				const saved: Saved = { endpoint: `${endpointBase}/${count}`, key: Array.from(bytes) };
				sessionStorage.setItem('mock-push', JSON.stringify(saved));
				return subscription(saved);
			};
			const permission = () => (sessionStorage.getItem('mock-permission') ?? 'default') as NotificationPermission;
			Object.defineProperty(Notification, 'permission', { get: permission });
			Notification.requestPermission = async () => {
				sessionStorage.setItem('mock-permission', outcome);
				return outcome;
			};
		},
		// The server keeps one device per endpoint, so parallel tests each need their own.
		[`https://push.example/${crypto.randomUUID()}`, permission === 'grant' ? 'granted' : 'denied'] as const,
	);
	await page.reload();
	return (seed: number) => (key = serverKey(seed));
}

const sheet = (app: App) => app.page.getByRole('dialog', { name: 'Notifications' });
const notificationsRow = (app: App) =>
	app.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Notifications/ });

const status = (label: string) => new RegExp(`^\\s*Notifications\\s*${label}\\s*$`);

async function openSheet(app: App, heading: string) {
	await notificationsRow(app).click();
	await expect(sheet(app).getByRole('heading', { name: heading })).toBeVisible();
}

/** Sets this device up as a sync device from the open Settings sheet, then closes it. */
async function setUpSync(app: App) {
	await app.settings().getByRole('button', { name: 'Set up sync' }).click();
	await app.settings().getByRole('textbox', { name: 'Setup code' }).fill(SYNC_SETUP_CODE);
	await app.settings().getByRole('button', { name: 'Turn on sync' }).click();
	await expect(app.settings().getByRole('status', { name: 'Sync status' })).toHaveText('Up to date');
	await app.page.keyboard.press('Escape');
	await expect(app.settings()).toBeHidden();
}

/** What the server will push to this device for tasks titled `title`, as `title@<ISO time>: body`. */
async function serverSchedule(page: Page, title: string) {
	const token = await page.evaluate(() => localStorage.getItem('procrastimate-device'));
	const response = await page.request.get('/api/push/schedule', { headers: { Authorization: `Bearer ${token}` } });
	const { notifications } = (await response.json()) as PushScheduleResponse;
	return notifications
		.filter(push => push.title === title)
		.map(push => `${push.title}@${new Date(push.at).toISOString()}: ${push.body}`);
}

/** The dev server runs on the real clock, so the browser's today is two days ahead of it, at 10:00 UTC. */
const now = new Date();
const TODAY = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2);
const todayAt = (hh: number, mm = 0) => new Date(TODAY + (hh * 60 + mm) * 60_000).toISOString();

/** Every test that syncs shares the server's one account, so titles carry a random suffix. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

test('the sidebar opens the Notifications sheet, which says when the server cannot push', async ({ app, page }) => {
	await page.route('/api/push/key', route => route.fulfill({ status: 503, json: { ok: false } }));
	await page.reload();
	await expect(notificationsRow(app)).toHaveText(status('Off'));
	await openSheet(app, 'Notifications aren’t available on this server');
	await page.keyboard.press('Escape');
	await expect(sheet(app)).toBeHidden();
});

test('push needs sync first, then the server schedules from synced tasks until push is turned off', async ({
	app,
	page,
}) => {
	await app.setNow(new Date(TODAY + 10 * 3_600_000));
	await mockPush(page, 'grant');
	await openSheet(app, 'Turn on sync first');
	await expect(notificationsRow(app)).toHaveText(status('Off'));
	await sheet(app).getByRole('button', { name: 'Turn on sync' }).click();
	await expect(sheet(app)).toBeHidden();
	await setUpSync(app);

	await openSheet(app, 'Get notified when tasks are due');
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
	await expect(notificationsRow(app)).toHaveText(status('On'));
	await page.keyboard.press('Escape');

	const title = unique('Call mom');
	await app.add(`${title} today 11:30am r30m`);
	await expect
		.poll(() => serverSchedule(page, title))
		.toEqual([`${title}@${todayAt(11)}: Due at 11:30 AM`, `${title}@${todayAt(11, 30)}: Due now`]);

	await app.go('Today');
	await app
		.row(title)
		.getByRole('checkbox', { name: `Complete ${title}` })
		.click();
	await expect.poll(() => serverSchedule(page, title)).toEqual([]);
	await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
	await expect.poll(() => serverSchedule(page, title)).toHaveLength(2);

	await openSheet(app, 'Notifications are on');
	await sheet(app).getByRole('button', { name: 'Turn off' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Get notified when tasks are due' })).toBeVisible();
	await expect.poll(() => serverSchedule(page, title)).toEqual([]);
	await expect(notificationsRow(app)).toHaveText(status('Off'));
});

test('a rotated server key resubscribes this device on the next launch without asking again', async ({ app, page }) => {
	const rotate = await mockPush(page, 'grant');
	await app.openSettings();
	await setUpSync(app);
	await openSheet(app, 'Get notified when tasks are due');
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(notificationsRow(app)).toHaveText(status('On'));
	const first = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-push')!).endpoint as string);

	rotate(1);
	const registered = page.waitForRequest(
		request => request.url().endsWith('/api/push/subscription') && request.method() === 'PUT',
	);
	await page.reload();
	const body = (await registered).postDataJSON() as { subscription: { endpoint: string } };
	const saved = await page.evaluate(
		() => JSON.parse(sessionStorage.getItem('mock-push')!) as { endpoint: string; key: number[] },
	);
	expect(saved.endpoint).not.toBe(first);
	expect(body.subscription.endpoint).toBe(saved.endpoint);
	expect(Buffer.from(saved.key).toString('base64url')).toBe(serverKey(1));
	await expect(notificationsRow(app)).toHaveText(status('On'));
});

test('a rekey that cannot reach the push service retries when the device comes back online', async ({ app, page }) => {
	const rotate = await mockPush(page, 'grant');
	await app.openSettings();
	await setUpSync(app);
	await openSheet(app, 'Get notified when tasks are due');
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(notificationsRow(app)).toHaveText(status('On'));
	await page.keyboard.press('Escape');

	rotate(2);
	await page.evaluate(() => sessionStorage.setItem('mock-push-down', '1'));
	await page.reload();
	await expect(notificationsRow(app)).toHaveText(status('Off'));
	await page.reload();
	await expect(notificationsRow(app)).toHaveText(status('Off'));

	const registered = page.waitForRequest(
		request => request.url().endsWith('/api/push/subscription') && request.method() === 'PUT',
	);
	await page.evaluate(() => {
		sessionStorage.removeItem('mock-push-down');
		window.dispatchEvent(new Event('online'));
	});
	await registered;
	await expect(notificationsRow(app)).toHaveText(status('On'));
	const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-push')!) as { key: number[] });
	expect(Buffer.from(saved.key).toString('base64url')).toBe(serverKey(2));
});

test('removing this device from sync takes push back to turning on sync first', async ({ app, page }) => {
	await mockPush(page, 'grant');
	await app.openSettings();
	await setUpSync(app);
	await openSheet(app, 'Get notified when tasks are due');
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(notificationsRow(app)).toHaveText(status('On'));
	await page.keyboard.press('Escape');

	await app.openSettings();
	await app
		.settings()
		.getByRole('button', { name: /\(this device\)$/ })
		.click();
	await expect(app.settings().getByRole('button', { name: 'Set up sync' })).toBeVisible();
	await page.keyboard.press('Escape');
	await openSheet(app, 'Turn on sync first');
});

test('a denied permission explains how to unblock notifications', async ({ app, page }) => {
	await mockPush(page, 'deny');
	await app.openSettings();
	await setUpSync(app);
	await openSheet(app, 'Get notified when tasks are due');
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Notifications are blocked' })).toBeVisible();
	await expect(sheet(app)).toContainText('Settings › Notifications › Procrastimate');
	await sheet(app).getByRole('button', { name: 'Check again' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Notifications are blocked' })).toBeVisible();
	await expect(notificationsRow(app)).toHaveText(status('Blocked'));
});

test('saving the first timed task while push is off offers to turn it on, once', async ({ app, page }) => {
	await mockPush(page, 'grant');
	const nudge = page.getByRole('status').filter({ hasText: 'Get notified when it’s due?' });
	await app.add('Buy milk');
	await expect(page.getByRole('status')).toHaveCount(0);

	await app.add('Call mom today 10:30am');
	await nudge.getByRole('button', { name: 'Turn on' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Turn on sync first' })).toBeVisible();
	await sheet(app).getByRole('button', { name: 'Not now' }).click();
	await expect(sheet(app)).toBeHidden();
	await expect(nudge).toHaveCount(0);

	await app.add('Gym today 6pm');
	await expect(app.row('Gym')).toBeVisible();
	await expect(nudge).toHaveCount(0);
});

test('a notification opens its task, from the launch URL or from the service worker', async ({ app, page }) => {
	await app.add('Call mom today 10:30am');
	const id = await page.evaluate(() => JSON.parse(localStorage.getItem('procrastimate')!).tasks[0].id as string);

	await page.goto(`/today?task=${id}`);
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call mom');
	await expect(page).toHaveURL('/today');
	await page.keyboard.press('Escape');
	await expect(app.details()).toBeHidden();

	await page.evaluate(taskId => {
		navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-task', taskId } }));
	}, id);
	await expect(app.details().getByRole('textbox', { name: 'Title' })).toHaveValue('Call mom');
});
