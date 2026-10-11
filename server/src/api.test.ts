import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from 'bun:test';
import { memoryAccount } from './account/account';
import api from './api';
import type { Env } from './bindings';
import { createReceiverKeys, decryptPush, type PushReceiver } from './push-receiver';
import { generateVapidKeys } from './web-push';

const NOW = Date.UTC(2026, 9, 10, 12);
const ENDPOINT = 'https://push.example.com/device-1';

async function vapidEnv(): Promise<Env> {
	const keys = await generateVapidKeys();
	return { ACCOUNT: memoryAccount(undefined), VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
}

let pushService: { status: number; received: string[]; receiver: PushReceiver };
let keys: { p256dh: string; auth: string };

beforeEach(async () => {
	setSystemTime(NOW);
	const receiverKeys = await createReceiverKeys();
	keys = receiverKeys.keys;
	pushService = { status: 201, received: [], receiver: receiverKeys.receiver };
	spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const body = new Uint8Array(await new Request(input, init).arrayBuffer());
		pushService.received.push(await decryptPush(body, pushService.receiver));
		return new Response(null, { status: pushService.status });
	}) as typeof fetch);
});

afterEach(() => {
	setSystemTime();
	mock.restore();
});

const call = (env: Env, method: string, path: string, body?: unknown) =>
	api.fetch(
		new Request(`https://procrastimate.test${path}`, {
			method,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		env,
	);

test('status and unknown routes', async () => {
	expect(await (await call({}, 'GET', '/api/status')).json()).toEqual({ ok: true });
	const missing = await call({}, 'GET', '/api/nope');
	expect(missing.status).toBe(404);
});

test('the push key needs the account binding and both VAPID secrets', async () => {
	const env = await vapidEnv();
	const unconfigured = await call({ ...env, VAPID_PRIVATE_KEY: undefined }, 'GET', '/api/push/key');
	expect(unconfigured.status).toBe(503);
	expect((await call({}, 'GET', '/api/push/key')).status).toBe(503);
	expect((await call({ ...env, ACCOUNT: undefined }, 'GET', '/api/push/key')).status).toBe(503);
	const configured = await call(env, 'GET', '/api/push/key');
	expect(configured.status).toBe(200);
	expect(await configured.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
});

test('the test push is sent immediately and reports a gone subscription as 410', async () => {
	const env = await vapidEnv();
	const sent = await call(env, 'POST', '/api/push/test', { subscription: { endpoint: ENDPOINT, keys } });
	expect(await sent.json()).toEqual({ ok: true });
	expect(JSON.parse(pushService.received[0]!)).toEqual({
		title: 'Notifications are on',
		body: 'Procrastimate will notify you here when tasks are due.',
		tag: 'test',
		taskId: null,
	});

	pushService.status = 410;
	const gone = await call(env, 'POST', '/api/push/test', { subscription: { endpoint: ENDPOINT, keys } });
	expect(gone.status).toBe(410);
	expect(await gone.json()).toEqual({ ok: false, status: 410 });

	pushService.status = 503;
	expect((await call(env, 'POST', '/api/push/test', { subscription: { endpoint: ENDPOINT, keys } })).status).toBe(502);
});
