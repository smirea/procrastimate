import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import type { PushMessage, ScheduledPush } from 'shared/push.ts';
import { createReceiverKeys, decryptPush, verifyVapid } from '../../server/src/push-receiver.ts';
import { expect, test, type App } from './fixtures.ts';

test.skip(process.env.E2E_WORKER !== '1', 'Needs the Worker, its Durable Objects, and VAPID keys');

type Received = { message: PushMessage; vapid: boolean };

/** A push service on loopback that decrypts what the Worker sends, the way a browser's push service would forward it. */
async function startPushService() {
	const { receiver, keys } = await createReceiverKeys();
	const received: Received[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const origin = `http://${request.headers.host}`;
		received.push({
			message: JSON.parse(await decryptPush(new Uint8Array(Buffer.concat(chunks)), receiver)),
			vapid: await verifyVapid(request.headers.authorization ?? null, origin),
		});
		response.writeHead(201).end();
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push/${crypto.randomUUID()}`;
	return { subscription: { endpoint, keys }, received, close: () => server.close() };
}

/** Playwright's Chromium cannot subscribe for real, so the browser hands out the loopback service's subscription. */
async function grantSubscription(page: Page, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
	await page.addInitScript(json => {
		let current: PushSubscription | null = null;
		PushManager.prototype.getSubscription = async () => current;
		PushManager.prototype.subscribe = async options => {
			current = {
				endpoint: json.endpoint,
				options,
				toJSON: () => json,
				unsubscribe: async () => {
					current = null;
					return true;
				},
			} as unknown as PushSubscription;
			return current;
		};
		let permission: NotificationPermission = 'default';
		Object.defineProperty(Notification, 'permission', { get: () => permission });
		Notification.requestPermission = async () => (permission = 'granted');
	}, subscription);
}

const sheet = (app: App) => app.page.getByRole('dialog', { name: 'Notifications' });

/** 10:00 UTC two days from now, so every time the test schedules is still ahead of the Worker's real clock. */
const now = new Date();
const TODAY = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2);
const tomorrowAt = (hh: number, mm = 0) => TODAY + 86_400_000 + (hh * 60 + mm) * 60_000;

test('the Worker keeps the schedule in sync with every change and pushes an encrypted test notification', async ({
	app,
	page,
}) => {
	const service = await startPushService();
	await grantSubscription(page, service.subscription);
	await app.setNow(new Date(TODAY + 10 * 3_600_000));
	await page.reload();
	const schedule = async () => {
		const url = `/api/push/schedule?endpoint=${encodeURIComponent(service.subscription.endpoint)}`;
		const { notifications } = (await (await page.request.get(url)).json()) as { notifications: ScheduledPush[] };
		return notifications.map(push => `${push.title}@${push.at}: ${push.body}`);
	};

	await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Notifications/ }).click();
	await sheet(app).getByRole('button', { name: 'Turn on notifications' }).click();
	await expect(sheet(app).getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
	await sheet(app).getByRole('button', { name: 'Send a test notification' }).click();
	await expect(sheet(app).getByRole('button', { name: 'Sent' })).toBeVisible();
	expect(service.received).toEqual([
		{
			message: {
				title: 'Notifications are on',
				body: 'Procrastimate will notify you here when tasks are due.',
				tag: 'test',
				taskId: null,
			},
			vapid: true,
		},
	]);
	await page.keyboard.press('Escape');

	await app.add('Call mom tomorrow 9am remind me at 9am', 'Gym tomorrow 6pm r30m', 'Taxes tomorrow', 'Pills every day 8am');
	await expect
		.poll(schedule)
		.toEqual([
			`Pills@${tomorrowAt(8)}: Due now`,
			`Call mom@${tomorrowAt(9)}: Due now`,
			`Gym@${tomorrowAt(17, 30)}: Due at 6:00 PM`,
			`Gym@${tomorrowAt(18)}: Due now`,
		]);

	await app.go('Upcoming');
	await app.row('Pills').getByRole('checkbox', { name: 'Complete Pills' }).click();
	await app.row('Gym').getByRole('button', { name: /Gym/ }).click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.fill('Gym tomorrow 7pm');
	await title.press('Enter');
	await app.details().getByRole('button', { name: 'Close' }).click();
	await app.row('Call mom').getByRole('button', { name: /Call mom/ }).click();
	await app.details().getByRole('button', { name: 'Delete task' }).click();
	await expect
		.poll(schedule)
		.toEqual([
			`Gym@${tomorrowAt(18, 30)}: Due at 7:00 PM`,
			`Gym@${tomorrowAt(19)}: Due now`,
			`Pills@${tomorrowAt(8) + 86_400_000}: Due now`,
		]);
	service.close();
});

test('the Worker delivers a scheduled push at its time once, even when the device resyncs it', async ({ page }) => {
	const service = await startPushService();
	const due = { at: Date.now() + 1500, taskId: 'task-1', title: 'Water plants', body: 'Due now' };
	const put = () =>
		page.request.put('/api/push/schedule', { data: { subscription: service.subscription, notifications: [due] } });
	expect(await (await put()).json()).toEqual({ ok: true, scheduled: 1 });

	await expect.poll(() => service.received.map(r => r.message), { timeout: 10_000 }).toEqual([
		{ title: 'Water plants', body: 'Due now', tag: `task-1:${due.at}`, taskId: 'task-1' },
	]);
	expect(service.received[0]?.vapid).toBe(true);
	expect(await (await put()).json()).toEqual({ ok: true, scheduled: 0 });
	await page.waitForTimeout(1500);
	expect(service.received.length).toBe(1);
	service.close();
});
