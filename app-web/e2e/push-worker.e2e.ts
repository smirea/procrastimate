import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { APIRequestContext, Page } from '@playwright/test';
import { INSTALL_GATE } from '../../shared/install-gate.mjs';
import type { PushMessage, PushScheduleResponse } from 'shared/push.ts';
import { createReceiverKeys, decryptPush, verifyVapid } from '../../server/src/push-receiver.ts';
import { expect, test, type App } from './fixtures.ts';

test.skip(process.env.E2E_WORKER !== '1', 'Needs the Worker, its Durable Object alarm, and VAPID keys');

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
async function grantSubscription(
	page: Page,
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
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

/** 10:00 UTC two days from now, so every time the test schedules is still ahead of the Worker's real clock. */
const now = new Date();
const TODAY = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2);
const tomorrowAt = (hh: number, mm = 0) => TODAY + 86_400_000 + (hh * 60 + mm) * 60_000;

/** The Worker's account outlives a run and every test shares it, so titles carry a random suffix. */
const suffix = () => crypto.randomUUID().slice(0, 8);

async function setUpSync(app: App) {
	await expect
		.poll(async () =>
			app.page.evaluate(() => {
				const token = localStorage.getItem('procrastimate-device');
				const raw = localStorage.getItem('procrastimate');
				const sync = raw ? (JSON.parse(raw) as { sync?: { outbox: unknown[]; reset?: boolean } }).sync : undefined;
				return Boolean(token && sync && !sync.reset && sync.outbox.length === 0);
			}),
		)
		.toBe(true);
}

async function schedule(request: APIRequestContext, token: string, tag: string) {
	const response = await request.get('/api/push/schedule', { headers: { Authorization: `Bearer ${token}` } });
	const { notifications } = (await response.json()) as PushScheduleResponse;
	return notifications
		.filter(push => push.title.endsWith(tag))
		.map(push => `${push.title.replace(` ${tag}`, '')}@${push.at}: ${push.body}`);
}

test('the Worker computes the schedule from synced tasks and pushes an encrypted test notification', async ({
	app,
	page,
}) => {
	const service = await startPushService();
	await grantSubscription(page, service.subscription);
	await app.setNow(new Date(TODAY + 10 * 3_600_000));
	await page.reload();
	await setUpSync(app);
	const token = (await page.evaluate(() => localStorage.getItem('procrastimate-device')))!;
	const tag = suffix();

	await app.openSettings();
	await expect(app.settings().getByText('Notifications: On', { exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	const subscription = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		return (await registration.pushManager.getSubscription())?.toJSON();
	});
	expect((await page.request.post('/api/push/test', { data: { subscription } })).ok()).toBe(true);
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
	await app.add(
		`Call mom ${tag} tomorrow 9am remind me at 9am`,
		`Gym ${tag} tomorrow 6pm r30m`,
		`Taxes ${tag} tomorrow`,
		`Pills ${tag} every day 8am`,
	);
	await expect
		.poll(() => schedule(page.request, token, tag))
		.toEqual([
			`Pills@${tomorrowAt(8)}: Due now`,
			`Call mom@${tomorrowAt(9)}: Due now`,
			`Gym@${tomorrowAt(17, 30)}: Due at 6:00 PM`,
			`Gym@${tomorrowAt(18)}: Due now`,
		]);

	await app.go('Upcoming');
	await app
		.row(`Pills ${tag}`)
		.getByRole('checkbox', { name: `Complete Pills ${tag}` })
		.click();
	await app.row(`Gym ${tag}`).getByRole('button', { name: /Gym/ }).click();
	const title = app.details().getByRole('textbox', { name: 'Title' });
	await title.fill(`Gym ${tag} tomorrow 7pm`);
	await title.press('Enter');
	await app.details().getByRole('button', { name: 'Close' }).click();
	await app
		.row(`Call mom ${tag}`)
		.getByRole('button', { name: /Call mom/ })
		.click();
	await app.details().getByRole('button', { name: 'Delete task' }).click();
	await expect
		.poll(() => schedule(page.request, token, tag))
		.toEqual([
			`Gym@${tomorrowAt(18, 30)}: Due at 7:00 PM`,
			`Gym@${tomorrowAt(19)}: Due now`,
			`Pills@${tomorrowAt(8) + 86_400_000}: Due now`,
		]);

	service.close();
});

test('the alarm pushes a task synced from another device once, at its time', async ({ request }) => {
	test.setTimeout(120_000);
	const service = await startPushService();
	const setup = async (name: string) => {
		const token = `token-${crypto.randomUUID()}`;
		const response = await request.post('/api/auth/register', {
			data: { gate: INSTALL_GATE, deviceId: crypto.randomUUID(), token, name },
		});
		const body = (await response.json()) as { deviceId: string };
		return { deviceId: body.deviceId, token };
	};
	const phone = await setup('Phone');
	const mac = await setup('Mac');
	const subscribed = await request.put('/api/push/subscription', {
		headers: { Authorization: `Bearer ${phone.token}` },
		data: { subscription: service.subscription },
	});
	expect(await subscribed.json()).toEqual({ ok: true });

	// Due times are whole minutes, so the task is due at the next minute at least five seconds away.
	const at = Math.ceil((Date.now() + 5000) / 60_000) * 60_000;
	const iso = new Date(at).toISOString();
	const id = crypto.randomUUID();
	const title = `Water plants ${suffix()}`;
	const push = async (kind: string, entityId: string, fields: object) => {
		const op = { opId: crypto.randomUUID(), hlc: `${Date.now()}:0:${mac.deviceId}`, kind, id: entityId, fields };
		const response = await request.post('/api/sync', {
			headers: { Authorization: `Bearer ${mac.token}` },
			data: { cursor: 0, ops: [op] },
		});
		expect(response.status()).toBe(200);
	};
	await push('settings', 'settings', { timeZone: 'UTC' });
	await push('task', id, {
		parentId: null,
		order: 0,
		title,
		notes: '',
		projectId: null,
		labelIds: [],
		due: { date: iso.slice(0, 10), time: iso.slice(11, 16) },
		recurrence: null,
		priority: 4,
		reminders: [],
		createdAt: Date.now(),
		completedAt: null,
		sourceKey: null,
		deleted: false,
	});

	const deliveries = () => service.received.filter(r => r.message.title === title);
	await expect.poll(() => deliveries().length, { timeout: 90_000 }).toBe(1);
	expect(deliveries()[0]).toEqual({
		message: { title, body: 'Due now', tag: `${id}:${at}`, taskId: id },
		vapid: true,
	});

	await push('task', id, { notes: 'resynced' });
	await new Promise(resolve => setTimeout(resolve, 2000));
	expect(deliveries().length).toBe(1);
	service.close();
});
