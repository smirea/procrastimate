import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { INSTALL_GATE } from '../../shared/auth';
import { memoryAccount } from './account/account';
import type { AccountStore } from './account/store';
import { storeFactories } from './account/test-stores';
import api from './api';
import { sha256 } from './auth';
import type { Env } from './bindings';

const NOW = Date.UTC(2026, 9, 10, 12);

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

const call = (env: Env, body?: unknown, token?: string) =>
	api.fetch(
		new Request('https://procrastinate.test/api/auth/register', {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		env,
	);

const registerBody = (token: string, deviceId: string = crypto.randomUUID(), name = 'Mac') => ({
	gate: INSTALL_GATE,
	deviceId,
	token,
	name,
});

test('register answers 503 without the ACCOUNT binding', async () => {
	expect((await call({}, registerBody('token-without-account'))).status).toBe(503);
});

describe.each(storeFactories)('register on the %s store', (_name, createStore) => {
	let store: AccountStore;
	let env: Env;

	beforeEach(() => {
		store = createStore();
		env = { ACCOUNT: memoryAccount(store) };
	});

	test('rejects a missing or wrong install gate and keeps no device', async () => {
		expect((await call(env, { ...registerBody('token-wrong-gate-01'), gate: 'nope' })).status).toBe(401);
		expect((await call(env, { deviceId: 'device', token: 'token-no-gate', name: 'Mac' })).status).toBe(400);
		expect(store.liveDevices()).toEqual([]);
	});

	test('registers an install and accepts the same token again', async () => {
		const token = 'token-mac-0123456789';
		const deviceId = 'device-mac';
		const first = await call(env, registerBody(token, deviceId, 'Mac'));
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ ok: true, deviceId });
		expect(store.deviceByTokenHash(await sha256(token))?.name).toBe('Mac');

		const again = await call(env, registerBody(token, 'other-id', 'Ignored'));
		expect(await again.json()).toEqual({ ok: true, deviceId });
		expect(store.liveDevices()).toHaveLength(1);
	});

	test('gives a taken device id a new one', async () => {
		store.addDevice({
			id: 'taken',
			name: 'Other',
			tokenHash: 'other-hash',
			createdAt: 1,
			lastSeenAt: 1,
			revokedAt: null,
		});
		const response = await call(env, registerBody('token-new-device-01', 'taken'));
		const body = (await response.json()) as { deviceId: string };
		expect(body.deviceId).not.toBe('taken');
		expect(store.hasDevice(body.deviceId)).toBe(true);
	});
});
