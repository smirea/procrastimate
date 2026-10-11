import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { DEVICE_HEADER } from '../../shared/auth';
import { memoryAccount } from './account/account';
import { memoryStore } from './account/memory-store';
import type { AccountStore } from './account/store';
import { registerDevice, TEST_AUTH_SECRET, withAuth } from './account/test-device';
import { storeFactories } from './account/test-stores';
import api from './api';
import type { Env } from './bindings';

const NOW = Date.UTC(2026, 9, 10, 12);

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

const signUp = (env: Env, email = `user-${crypto.randomUUID()}@procrastinate.test`) =>
	api.fetch(
		new Request('https://procrastinate.test/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://procrastinate.test' },
			body: JSON.stringify({ email, password: 'test-password-1', name: 'Test' }),
		}),
		env,
	);

test('sign-in is off without a secret, and sync is off without the account', async () => {
	expect((await signUp({})).status).toBe(503);
	const env: Env = { BETTER_AUTH_SECRET: TEST_AUTH_SECRET };
	expect((await signUp(env)).status).toBe(200);
	const token = (await signUp(env)).headers.get('set-auth-token');
	expect(token).toBeTruthy();
	expect(
		(
			await api.fetch(
				new Request('https://procrastinate.test/api/sync', {
					method: 'POST',
					headers: { Authorization: `Bearer ${token}`, [DEVICE_HEADER]: crypto.randomUUID() },
					body: JSON.stringify({ cursor: 0, ops: [] }),
				}),
				env,
			)
		).status,
	).toBe(503);
});

describe.each(storeFactories)('a session on the %s store', (_name, createStore) => {
	let store: AccountStore;
	let env: Env;

	beforeEach(() => {
		store = createStore();
		env = withAuth({ ACCOUNT: memoryAccount(store) });
	});

	test('a session creates the device, and a revoked device stays signed out', async () => {
		const first = await registerDevice(env, 'Mac');
		expect(store.liveDevices().map(device => device.name)).toEqual(['Mac']);
		const again = await api.fetch(
			new Request('https://procrastinate.test/api/sync', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					Authorization: `Bearer ${first.token}`,
					[DEVICE_HEADER]: first.deviceId,
				},
				body: JSON.stringify({ cursor: 0, ops: [] }),
			}),
			env,
		);
		expect(again.status).toBe(200);
		expect(store.liveDevices()).toHaveLength(1);

		store.revokeDevice(first.deviceId, NOW);
		expect(again.ok).toBe(true);
		const rejected = await api.fetch(
			new Request('https://procrastinate.test/api/sync', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					Authorization: `Bearer ${first.token}`,
					[DEVICE_HEADER]: first.deviceId,
				},
				body: JSON.stringify({ cursor: 0, ops: [] }),
			}),
			env,
		);
		expect(rejected.status).toBe(401);
	});

	test('two users do not share tasks', async () => {
		const first = await registerDevice(env, 'Mac');
		const otherEnv: Env = { ACCOUNT: env.ACCOUNT, BETTER_AUTH_SECRET: TEST_AUTH_SECRET };
		const second = await registerDevice(otherEnv, 'Phone');
		expect(first.token).not.toBe(second.token);
		expect(store.liveDevices().map(device => device.id)).toEqual([first.deviceId]);
	});

	test('delete account removes the user and their tasks', async () => {
		const credentials = await registerDevice(env, 'Mac');
		const response = await api.fetch(
			new Request('https://procrastinate.test/api/account/delete', {
				method: 'POST',
				headers: { Authorization: `Bearer ${credentials.token}`, [DEVICE_HEADER]: credentials.deviceId },
			}),
			env,
		);
		expect(response.status).toBe(200);
		expect(store.liveDevices()).toEqual([]);
		expect(store.entities()).toEqual([]);
		const again = await api.fetch(
			new Request('https://procrastinate.test/api/sync', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${credentials.token}`,
					[DEVICE_HEADER]: credentials.deviceId,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ cursor: 0, ops: [] }),
			}),
			env,
		);
		expect(again.status).toBe(401);
	});
});

test('methods hides providers that have no credentials', async () => {
	const response = await api.fetch(new Request('https://procrastinate.test/api/auth/methods'), {
		BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
	});
	expect(await response.json()).toEqual({
		email: true,
		google: false,
		apple: false,
		googleIosClientId: null,
		appleNative: false,
	});
});

test('an empty store is what a second user starts from', () => {
	expect(memoryStore().liveDevices()).toEqual([]);
});
