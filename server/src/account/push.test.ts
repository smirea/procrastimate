import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { MAX_SCHEDULED, type PushMessage, type PushSubscriptionInfo } from '../../../shared/push';
import type { PushScheduleResponse } from '../../../shared/api/contract';
import { completeTask } from '../../../shared/store';
import { applyResponse, commit, startSync, type ClientSync } from '../../../shared/sync/apply';
import type { Snapshot, SyncResponse } from '../../../shared/sync/protocol';
import { counter, snapshotOf, task } from '../../../shared/sync/testing';
import type { Task } from '../../../shared/task';
import api from '../api';
import type { Env } from '../bindings';
import { memoryAccount } from './account';
import { deliverDue } from './push';
import type { AccountStore } from './store';
import { authHeaders, registerDevice, withAuth, type DeviceCredentials } from './test-device';
import { storeFactories } from './test-stores';

/** Saturday, October 10 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 9, 10, 12);
const HOUR = 3_600_000;

const subscriptionFor = (name: string): PushSubscriptionInfo => ({
	endpoint: `https://push.example/${name}`,
	keys: { p256dh: `${name}-p256dh`, auth: `${name}-auth` },
});

afterEach(() => setSystemTime());

describe.each(storeFactories)('server-computed push on the %s store', (_name, createStore) => {
	let store: AccountStore;
	let env: Env;
	let alarm: number | null;
	let sent: { endpoint: string; message: PushMessage }[];
	let status: (endpoint: string) => number | null;

	beforeEach(() => {
		setSystemTime(NOW);
		store = createStore();
		alarm = null;
		sent = [];
		status = () => 201;
		env = withAuth({ ACCOUNT: memoryAccount(store, async at => void (alarm = at)) });
	});

	const call = async (method: string, path: string, cred: DeviceCredentials | string | null, body?: unknown) =>
		api.fetch(
			new Request(`https://procrastimate.test${path}`, {
				method,
				headers: {
					'content-type': 'application/json',
					...(typeof cred === 'string' ? { Authorization: `Bearer ${cred}` } : cred ? authHeaders(cred) : {}),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
			}),
			env,
		);

	/** Runs the alarm at the time it was armed for, as the Durable Object runtime does. */
	async function fireAlarm() {
		if (alarm === null) throw new Error('No alarm is armed');
		setSystemTime(alarm);
		alarm = await deliverDue(store, alarm, async (subscription, message) => {
			sent.push({ endpoint: subscription.endpoint, message });
			return status(subscription.endpoint);
		});
	}

	const received = (name: string) =>
		sent.filter(push => push.endpoint === subscriptionFor(name).endpoint).map(push => push.message);

	/** A paired device with its own copy of the data, which syncs each edit the way the clients do. */
	async function device(name: string, initial: Snapshot = snapshotOf()) {
		const credentials = await registerDevice(env, name);
		const nextOpId = counter(`${name}-op-`);
		let snapshot = initial;
		let sync: ClientSync = startSync(snapshot, credentials.deviceId, Date.now(), nextOpId);
		const pull = async () => {
			const response = await call('POST', '/api/sync', credentials, { cursor: sync.cursor, ops: sync.outbox });
			expect(response.status).toBe(200);
			({ snapshot, sync } = applyResponse(snapshot, sync, (await response.json()) as SyncResponse));
		};
		await pull();
		return {
			...credentials,
			get snapshot() {
				return snapshot;
			},
			pull,
			async edit(change: (snapshot: Snapshot) => Snapshot) {
				const after = change(snapshot);
				sync = commit(sync, snapshot, after, Date.now(), nextOpId);
				snapshot = after;
				await pull();
			},
			async subscribe() {
				const response = await call('PUT', '/api/push/subscription', credentials, {
					subscription: subscriptionFor(name),
				});
				expect(await response.json()).toEqual({ ok: true });
			},
			async schedule() {
				const response = await call('GET', '/api/push/schedule', credentials);
				const { notifications } = (await response.json()) as PushScheduleResponse;
				return notifications.map(push => `${push.title}@${(push.at - NOW) / 60_000}m: ${push.body}`);
			},
		};
	}

	const addTask = (added: Task) => (snapshot: Snapshot) => ({ ...snapshot, tasks: [...snapshot.tasks, added] });
	const complete = (id: string, now: number) => (snapshot: Snapshot) => {
		const { tasks, projects, labels } = snapshot;
		return { ...snapshot, ...completeTask({ tasks, projects, labels }, id, '2026-10-10', now)!.data };
	};

	test('a change on one device notifies every subscribed device once, at its time', async () => {
		const mac = await device('mac');
		const phone = await device('phone');
		const ipad = await device('ipad');
		await mac.subscribe();
		await phone.subscribe();
		expect(alarm).toBe(null);

		await ipad.edit(addTask(task('call', { title: 'Call mom', due: { date: '2026-10-10', time: '13:00' } })));
		expect(alarm).toBe(NOW + HOUR);
		expect(await phone.schedule()).toEqual(['Call mom@60m: Due now']);
		expect(await ipad.schedule()).toEqual([]);

		await fireAlarm();
		const message = { title: 'Call mom', body: 'Due now', tag: `call:${NOW + HOUR}`, taskId: 'call' };
		expect(received('mac')).toEqual([message]);
		expect(received('phone')).toEqual([message]);
		expect(received('ipad')).toEqual([]);
		expect(alarm).toBe(null);

		await mac.edit(snapshot => ({ ...snapshot, tasks: snapshot.tasks.map(t => ({ ...t, notes: 'again' })) }));
		expect(await mac.schedule()).toEqual([]);
		expect(alarm).toBe(null);
		expect(sent.length).toBe(2);
	});

	test('times and bodies follow the synced time zone, which a device writes when it moves', async () => {
		const mac = await device('mac', snapshotOf({ settings: { timeZone: 'America/New_York' } }));
		await mac.subscribe();
		await mac.edit(
			addTask(
				task('gym', {
					title: 'Gym',
					due: { date: '2026-10-11', time: '13:00' },
					reminders: [{ kind: 'before', minutes: 30 }],
				}),
			),
		);
		// 13:00 in New York is 17:00 UTC.
		expect(await mac.schedule()).toEqual(['Gym@1710m: Due at 1:00 PM', 'Gym@1740m: Due now']);
		expect(alarm).toBe(NOW + 1710 * 60_000);

		await mac.edit(snapshot => ({ ...snapshot, settings: { timeZone: 'Asia/Tokyo' } }));
		// 13:00 in Tokyo is 04:00 UTC.
		expect(await mac.schedule()).toEqual(['Gym@930m: Due at 1:00 PM', 'Gym@960m: Due now']);
		expect(alarm).toBe(NOW + 930 * 60_000);
	});

	test('an unknown synced zone falls back to UTC', async () => {
		const mac = await device('mac', snapshotOf({ settings: { timeZone: 'Mars/Olympus' } }));
		await mac.subscribe();
		await mac.edit(addTask(task('call', { title: 'Call', due: { date: '2026-10-10', time: '13:00' } })));
		expect(await mac.schedule()).toEqual(['Call@60m: Due now']);
	});

	test('completing silences a task, and completing a repeating one schedules its next occurrence', async () => {
		const mac = await device('mac');
		const phone = await device('phone');
		await phone.subscribe();
		await mac.edit(addTask(task('call', { title: 'Call', due: { date: '2026-10-10', time: '14:00' } })));
		await mac.edit(
			addTask(
				task('pills', {
					title: 'Pills',
					due: { date: '2026-10-10', time: '13:00' },
					recurrence: { interval: 1, unit: 'day' },
					reminders: [{ kind: 'before', minutes: 15 }],
				}),
			),
		);
		expect(await phone.schedule()).toEqual(['Pills@45m: Due at 1:00 PM', 'Pills@60m: Due now', 'Call@120m: Due now']);

		await mac.edit(complete('call', Date.now()));
		await mac.edit(complete('pills', Date.now()));
		expect(await phone.schedule()).toEqual(['Pills@1485m: Due at 1:00 PM', 'Pills@1500m: Due now']);
		expect(alarm).toBe(NOW + 1485 * 60_000);
	});

	test('a failed send retries that device a minute later for up to ten minutes, without resending to the others', async () => {
		const mac = await device('mac');
		const phone = await device('phone');
		await mac.subscribe();
		await phone.subscribe();
		await mac.edit(addTask(task('call', { title: 'Call', due: { date: '2026-10-10', time: '13:00' } })));
		status = endpoint => (endpoint === subscriptionFor('phone').endpoint ? 503 : 201);

		await fireAlarm();
		expect(received('mac').length).toBe(1);
		expect(received('phone').length).toBe(1);
		expect(alarm).toBe(NOW + HOUR + 60_000);
		expect(await phone.schedule()).toEqual(['Call@60m: Due now']);
		expect(await mac.schedule()).toEqual([]);

		// A sync between tries keeps the retry for the phone and does not bring the push back for the Mac.
		setSystemTime(NOW + HOUR + 30_000);
		await mac.edit(snapshot => ({ ...snapshot, tasks: snapshot.tasks.map(t => ({ ...t, notes: 'call back' })) }));
		expect(await phone.schedule()).toEqual(['Call@60m: Due now']);
		expect(await mac.schedule()).toEqual([]);
		expect(alarm).toBe(NOW + HOUR + 60_000);

		status = () => 201;
		await fireAlarm();
		expect(received('mac').length).toBe(1);
		expect(received('phone').length).toBe(2);
		expect(alarm).toBe(null);
	});

	test('a retry gives up once the push is ten minutes stale', async () => {
		const mac = await device('mac');
		await mac.subscribe();
		await mac.edit(addTask(task('call', { title: 'Call', due: { date: '2026-10-10', time: '13:00' } })));
		status = () => null;
		for (let i = 0; i < 20 && alarm !== null; i++) await fireAlarm();
		expect(received('mac').length).toBe(11);
		expect(alarm).toBe(null);
		expect(await mac.schedule()).toEqual([]);
	});

	test('completing a task during a retry stops the retry', async () => {
		const mac = await device('mac');
		await mac.subscribe();
		await mac.edit(addTask(task('call', { title: 'Call', due: { date: '2026-10-10', time: '13:00' } })));
		status = () => 500;
		await fireAlarm();
		await mac.edit(complete('call', Date.now()));
		expect(await mac.schedule()).toEqual([]);
		expect(alarm).toBe(null);
	});

	test('a task made due a moment ago never notifies, and a sync before a late alarm fires it at once', async () => {
		const mac = await device('mac');
		await mac.subscribe();
		await mac.edit(addTask(task('past', { title: 'Past', due: { date: '2026-10-10', time: '11:58' } })));
		expect(await mac.schedule()).toEqual([]);
		expect(alarm).toBe(null);

		await mac.edit(addTask(task('soon', { title: 'Soon', due: { date: '2026-10-10', time: '12:01' } })));
		expect(alarm).toBe(NOW + 60_000);
		setSystemTime(NOW + 65_000);
		await mac.edit(snapshot => ({ ...snapshot, tasks: snapshot.tasks.map(t => ({ ...t, notes: 'late' })) }));
		expect(alarm).toBe(NOW + 65_000);
		await fireAlarm();
		expect(received('mac').map(message => message.title)).toEqual(['Soon']);
	});

	test('a full batch of delivered pushes does not crowd out the next one', async () => {
		const mac = await device('mac');
		await mac.subscribe();
		const batch = Array.from({ length: MAX_SCHEDULED }, (_, i) =>
			task(`t${i}`, { title: `Task ${i}`, due: { date: '2026-10-10', time: '13:00' } }),
		);
		const later = task('later', { title: 'Later', due: { date: '2026-10-10', time: '14:00' } });
		await mac.edit(snapshot => ({ ...snapshot, tasks: [...snapshot.tasks, ...batch, later] }));
		await fireAlarm();
		expect(sent.length).toBe(MAX_SCHEDULED);
		expect(await mac.schedule()).toEqual(['Later@120m: Due now']);
		expect(alarm).toBe(NOW + 2 * HOUR);
	});

	test('a gone subscription, unsubscribing, and revoking the device each stop its pushes', async () => {
		const mac = await device('mac');
		const phone = await device('phone');
		const ipad = await device('ipad');
		for (const each of [mac, phone, ipad]) await each.subscribe();
		await mac.edit(addTask(task('call', { title: 'Call', due: { date: '2026-10-10', time: '13:00' } })));
		await mac.edit(addTask(task('gym', { title: 'Gym', due: { date: '2026-10-10', time: '14:00' } })));
		status = endpoint => (endpoint === subscriptionFor('mac').endpoint ? 410 : 201);

		expect(await (await call('DELETE', '/api/push/subscription', phone)).json()).toEqual({ ok: true });
		expect(store.revokeDevice(ipad.deviceId, NOW)).toBe(true);
		await fireAlarm();
		expect(received('mac').length).toBe(1);
		expect(received('phone')).toEqual([]);
		expect(received('ipad')).toEqual([]);
		expect(store.pushTargets()).toEqual([]);
		expect(alarm).toBe(null);
	});

	test('a browser that pairs again as a new device moves its subscription to it', async () => {
		const old = await device('mac');
		await old.subscribe();
		const again = await device('mac');
		await again.subscribe();
		expect(store.pushTargets().map(target => target.deviceId)).toEqual([again.deviceId]);
	});

	test('the push routes need a device token and a valid subscription', async () => {
		const mac = await device('mac');
		const subscription = subscriptionFor('mac');
		expect((await call('PUT', '/api/push/subscription', null, { subscription })).status).toBe(401);
		expect((await call('PUT', '/api/push/subscription', 'made-up', { subscription })).status).toBe(401);
		expect((await call('DELETE', '/api/push/subscription', null)).status).toBe(401);
		expect((await call('GET', '/api/push/schedule', null)).status).toBe(401);
		const insecure = { subscription: { ...subscription, endpoint: 'http://evil.example/push' } };
		expect((await call('PUT', '/api/push/subscription', mac, insecure)).status).toBe(400);
		const missingKeys = { subscription: { endpoint: subscription.endpoint } };
		expect((await call('PUT', '/api/push/subscription', mac, missingKeys)).status).toBe(400);
		expect((await call('PUT', '/api/push/subscription', mac, 'not json')).status).toBe(400);
		const loopback = { subscription: { ...subscription, endpoint: 'http://127.0.0.1:9000/push' } };
		expect((await call('PUT', '/api/push/subscription', mac, loopback)).status).toBe(200);
	});
});
