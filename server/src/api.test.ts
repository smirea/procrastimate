import type { DurableObjectNamespace, DurableObjectState } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, mock, setSystemTime, spyOn, test } from 'bun:test';
import api from './api';
import { PushSchedule, type Env } from './push';
import { createReceiverKeys, decryptPush, type PushReceiver } from './push-receiver';
import { generateVapidKeys } from './web-push';

const NOW = Date.UTC(2026, 9, 10, 12);
const ENDPOINT = 'https://push.example.com/device-1';

function fakeState() {
	const data = new Map<string, unknown>();
	let alarm: number | null = null;
	const storage = {
		get: async (key: string) => structuredClone(data.get(key)),
		put: async (entries: Record<string, unknown>) => {
			for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
		},
		delete: async (key: string) => data.delete(key),
		deleteAll: async () => data.clear(),
		setAlarm: async (at: number) => {
			alarm = at;
		},
		deleteAlarm: async () => {
			alarm = null;
		},
	};
	return { state: { storage } as unknown as DurableObjectState, data, alarm: () => alarm };
}

type Harness = { env: Env; objects: Map<string, { object: PushSchedule } & ReturnType<typeof fakeState>> };

async function harness(): Promise<Harness> {
	const keys = await generateVapidKeys();
	const objects: Harness['objects'] = new Map();
	const env: Env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey };
	const namespace = {
		idFromName: (name: string) => name,
		get: (name: string) => {
			if (!objects.has(name)) {
				const fake = fakeState();
				objects.set(name, { ...fake, object: new PushSchedule(fake.state, env) });
			}
			const { object } = objects.get(name)!;
			return { fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)) };
		},
	};
	env.PUSH = namespace as unknown as DurableObjectNamespace;
	return { env, objects };
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

const scheduled = (taskId: string, offset: number) => ({
	taskId,
	at: NOW + offset,
	title: `Do ${taskId}`,
	body: 'Due',
});
const schedule = (notifications: ReturnType<typeof scheduled>[]) => ({
	subscription: { endpoint: ENDPOINT, keys },
	notifications,
});
const getSchedule = async (env: Env) =>
	(await (await call(env, 'GET', `/api/push/schedule?endpoint=${encodeURIComponent(ENDPOINT)}`)).json()) as {
		notifications: { taskId: string; at: number }[];
	};
const tasksIn = async (env: Env) => (await getSchedule(env)).notifications.map(p => `${p.taskId}@${p.at - NOW}`);

test('status and unknown routes', async () => {
	expect(await (await call({}, 'GET', '/api/status')).json()).toEqual({ ok: true });
	const missing = await call({}, 'GET', '/api/nope');
	expect(missing.status).toBe(404);
});

test('the push key needs the binding and both VAPID secrets', async () => {
	const { env } = await harness();
	const unconfigured = await call({ ...env, VAPID_PRIVATE_KEY: undefined }, 'GET', '/api/push/key');
	expect(unconfigured.status).toBe(503);
	expect((await call({}, 'GET', '/api/push/key')).status).toBe(503);
	const configured = await call(env, 'GET', '/api/push/key');
	expect(configured.status).toBe(200);
	expect(await configured.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
});

test('schedule uploads are validated at the boundary', async () => {
	const { env, objects } = await harness();
	const missingKeys = await call(env, 'PUT', '/api/push/schedule', {
		subscription: { endpoint: ENDPOINT },
		notifications: [],
	});
	expect(missingKeys.status).toBe(400);
	const insecure = await call(env, 'PUT', '/api/push/schedule', {
		subscription: { endpoint: 'http://evil.example/push', keys },
		notifications: [],
	});
	expect(insecure.status).toBe(400);
	expect((await call(env, 'PUT', '/api/push/schedule', 'not json')).status).toBe(400);
	expect(objects.size).toBe(0);
	const loopback = await call(env, 'PUT', '/api/push/schedule', {
		subscription: { endpoint: 'http://127.0.0.1:9000/push', keys },
		notifications: [],
	});
	expect(await loopback.json()).toEqual({ ok: true, scheduled: 0 });
});

describe('the per-subscription schedule', () => {
	test('stores the plan and arms the alarm for the earliest push, converging when uploaded twice', async () => {
		const { env, objects } = await harness();
		const upload = schedule([scheduled('b', 9000), scheduled('a', 5000), scheduled('a', 5000)]);
		expect(await (await call(env, 'PUT', '/api/push/schedule', upload)).json()).toEqual({ ok: true, scheduled: 2 });
		expect(await (await call(env, 'PUT', '/api/push/schedule', upload)).json()).toEqual({ ok: true, scheduled: 2 });
		expect(await tasksIn(env)).toEqual(['a@5000', 'b@9000']);
		expect(objects.get(ENDPOINT)!.alarm()).toBe(NOW + 5000);
	});

	test('the alarm delivers due pushes once, even when the device re-uploads them', async () => {
		const { env, objects } = await harness();
		await call(env, 'PUT', '/api/push/schedule', schedule([scheduled('a', 5000), scheduled('b', 9000)]));
		const device = objects.get(ENDPOINT)!;

		setSystemTime(NOW + 5000);
		await device.object.alarm();

		expect(pushService.received.map(text => JSON.parse(text))).toEqual([
			{ title: 'Do a', body: 'Due', tag: `a:${NOW + 5000}`, taskId: 'a' },
		]);
		expect(await tasksIn(env)).toEqual(['b@9000']);
		expect(device.alarm()).toBe(NOW + 9000);

		await call(env, 'PUT', '/api/push/schedule', schedule([scheduled('a', 5000), scheduled('b', 9000)]));
		expect(await tasksIn(env)).toEqual(['b@9000']);
	});

	test('a gone subscription wipes the device state', async () => {
		const { env, objects } = await harness();
		await call(env, 'PUT', '/api/push/schedule', schedule([scheduled('a', 5000), scheduled('b', 9000)]));
		const device = objects.get(ENDPOINT)!;
		pushService.status = 410;

		setSystemTime(NOW + 5000);
		await device.object.alarm();

		expect([...device.data.keys()]).toEqual([]);
		expect(device.alarm()).toBe(null);
	});

	test('a push service error keeps the push and retries in a minute', async () => {
		const { env, objects } = await harness();
		await call(env, 'PUT', '/api/push/schedule', schedule([scheduled('a', 5000), scheduled('b', 900_000)]));
		const device = objects.get(ENDPOINT)!;
		pushService.status = 500;

		setSystemTime(NOW + 5000);
		await device.object.alarm();

		expect(await tasksIn(env)).toEqual(['a@5000', 'b@900000']);
		expect(device.alarm()).toBe(NOW + 65_000);

		pushService.status = 201;
		setSystemTime(NOW + 65_000);
		await device.object.alarm();
		expect(pushService.received.length).toBe(2);
		expect(await tasksIn(env)).toEqual(['b@900000']);
	});

	test('DELETE clears the schedule and the alarm', async () => {
		const { env, objects } = await harness();
		await call(env, 'PUT', '/api/push/schedule', schedule([scheduled('a', 5000)]));
		expect(await (await call(env, 'DELETE', '/api/push/schedule', { endpoint: ENDPOINT })).json()).toEqual({
			ok: true,
		});
		expect(await tasksIn(env)).toEqual([]);
		expect(objects.get(ENDPOINT)!.alarm()).toBe(null);
	});
});

test('the test push is sent immediately and reports a gone subscription as 410', async () => {
	const { env } = await harness();
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
