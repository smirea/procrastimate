import type { Page } from '@playwright/test';
import type { ScheduleRequest } from 'shared/push.ts';
import { expect, test, type App } from './fixtures.ts';

const KEY = Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString('base64url');
const ENDPOINT = 'https://push.example/device-1';

type Server = { schedules: ScheduleRequest[]; deleted: unknown[] };

/**
 * Stands in for the push server and the browser's push service. Playwright's Chromium contexts cannot
 * subscribe for real, so `PushManager` hands out a fake subscription bound to the served key.
 */
async function mockPush(page: Page, permission: 'grant' | 'deny'): Promise<Server> {
	const server: Server = { schedules: [], deleted: [] };
	await page.route('/api/push/key', route => route.fulfill({ json: { publicKey: KEY } }));
	await page.route('/api/push/schedule', async route => {
		const body = route.request().postDataJSON();
		if (route.request().method() === 'PUT') server.schedules.push(body);
		else server.deleted.push(body);
		await route.fulfill({ status: 204 });
	});
	await page.addInitScript(
		([key, endpoint, outcome]) => {
			const bytes = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
			let current: PushSubscription | null = null;
			PushManager.prototype.getSubscription = async () => current;
			PushManager.prototype.subscribe = async () => {
				current = {
					endpoint,
					options: { applicationServerKey: bytes.buffer, userVisibleOnly: true },
					toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
					unsubscribe: async () => {
						current = null;
						return true;
					},
				} as unknown as PushSubscription;
				return current;
			};
			let permission: NotificationPermission = 'default';
			Object.defineProperty(Notification, 'permission', { get: () => permission });
			Notification.requestPermission = async () => (permission = outcome);
		},
		[KEY, ENDPOINT, permission === 'grant' ? 'granted' : 'denied'] as const,
	);
	await page.reload();
	return server;
}

const sheet = (app: App) => app.page.getByRole('dialog', { name: 'Notifications' });
const notificationsRow = (app: App) =>
	app.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Notifications/ });

const status = (label: string) => new RegExp(`^\\s*Notifications\\s*${label}\\s*$`);

async function openSheet(app: App, heading: string) {
	await notificationsRow(app).click();
	await expect(sheet(app).getByRole('heading', { name: heading })).toBeVisible();
}

test('the sidebar opens the Notifications sheet, which says when the server cannot push', async ({ app, page }) => {
	await page.route('/api/push/key', route => route.fulfill({ status: 503, json: { ok: false } }));
	await page.reload();
	await expect(notificationsRow(app)).toHaveText(status('Off'));
	await openSheet(app, 'Notifications aren’t available on this server');
	await page.keyboard.press('Escape');
	await expect(sheet(app)).toBeHidden();
});

test('turning on subscribes, then every change replaces the schedule and turning off deletes it', async ({
	app,
	page,
}) => {
	const server = await mockPush(page, 'grant');
	await openSheet(app, 'Get notified when tasks are due');
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
	await expect(sheet(app)).toContainText('Nothing scheduled yet');
	await expect(notificationsRow(app)).toHaveText(status('On'));
	const subscription = { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
	await expect.poll(() => server.schedules).toEqual([{ subscription, notifications: [] }]);

	await page.keyboard.press('Escape');
	await app.add('Call mom today 10:30am');
	const callMom = {
		at: Date.parse('2026-10-14T10:30:00Z'),
		taskId: expect.any(String),
		title: 'Call mom',
		body: 'Due now',
	};
	await expect.poll(() => server.schedules.at(-1)).toEqual({ subscription, notifications: [callMom] });

	await app.go('Today');
	await app.row('Call mom').getByRole('checkbox', { name: 'Complete Call mom' }).click();
	await expect.poll(() => server.schedules.at(-1)).toEqual({ subscription, notifications: [] });
	expect(server.schedules.length).toBe(3);

	await openSheet(app, 'Notifications are on');
	await sheet(app).getByRole('button', { name: 'Turn off' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Get notified when tasks are due' })).toBeVisible();
	await expect.poll(() => server.deleted).toEqual([{ endpoint: ENDPOINT }]);
	await expect(notificationsRow(app)).toHaveText(status('Off'));
});

test('a denied permission explains how to unblock notifications', async ({ app, page }) => {
	await mockPush(page, 'deny');
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
	await expect(sheet(app).getByRole('heading', { name: 'Get notified when tasks are due' })).toBeVisible();
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
