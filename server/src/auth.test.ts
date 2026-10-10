import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
	PAIRING_ALPHABET,
	PAIRING_TTL_MS,
	type DeviceCredentials,
	type DeviceList,
	type PairingCode,
} from '../../shared/auth';
import { memoryAccount } from './account/account';
import type { AccountStore } from './account/store';
import { storeFactories } from './account/test-stores';
import api from './api';
import { sha256 } from './auth';
import type { Env } from './bindings';

const NOW = Date.UTC(2026, 9, 10, 12);
const SETUP_CODE = 'correct-horse-battery-staple';

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

const call = (env: Env, method: string, path: string, body?: unknown, token?: string) =>
	api.fetch(
		new Request(`https://procrastimate.test${path}`, {
			method,
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		env,
	);

test('every auth route answers 503 without the ACCOUNT binding', async () => {
	for (const [method, path] of [
		['POST', '/api/auth/setup'],
		['POST', '/api/auth/pair'],
		['POST', '/api/auth/redeem'],
		['GET', '/api/auth/devices'],
		['DELETE', '/api/auth/devices'],
	] as const) {
		expect((await call({}, method, path, {})).status).toBe(503);
	}
});

test('setup answers 503 when the SYNC_SETUP_CODE secret is missing or empty', async () => {
	for (const code of [undefined, '']) {
		const response = await call({ ACCOUNT: memoryAccount(code) }, 'POST', '/api/auth/setup', {
			code: 'x',
			name: 'Mac',
		});
		expect(response.status).toBe(503);
	}
});

describe.each(storeFactories)('auth on the %s store', (_name, createStore) => {
	let store: AccountStore;
	let env: Env;

	beforeEach(() => {
		store = createStore();
		env = { ACCOUNT: memoryAccount(SETUP_CODE, store) };
	});

	async function setup(name = 'Mac') {
		const response = await call(env, 'POST', '/api/auth/setup', { code: SETUP_CODE, name });
		expect(response.status).toBe(200);
		return response.json() as Promise<DeviceCredentials>;
	}

	async function pair(token: string) {
		const response = await call(env, 'POST', '/api/auth/pair', undefined, token);
		expect(response.status).toBe(200);
		return response.json() as Promise<PairingCode>;
	}

	const redeem = (code: string, name = 'iPhone') => call(env, 'POST', '/api/auth/redeem', { code, name });

	const devices = async (token: string) => {
		const response = await call(env, 'GET', '/api/auth/devices', undefined, token);
		return { status: response.status, body: (await response.json()) as DeviceList };
	};

	test('setup with the right code issues a token that authenticates', async () => {
		const { deviceId, token } = await setup();
		expect(Buffer.from(token, 'base64url')).toHaveLength(32);
		const { status, body } = await devices(token);
		expect(status).toBe(200);
		expect(body.devices).toEqual([{ id: deviceId, name: 'Mac', createdAt: NOW, lastSeenAt: NOW, current: true }]);
	});

	test('setup rejects a wrong code and an invalid body', async () => {
		expect((await call(env, 'POST', '/api/auth/setup', { code: 'nope', name: 'Mac' })).status).toBe(401);
		expect((await call(env, 'POST', '/api/auth/setup', { code: SETUP_CODE, name: ' ' })).status).toBe(400);
		expect((await call(env, 'POST', '/api/auth/setup', 'not json')).status).toBe(400);
		expect(store.liveDevices()).toEqual([]);
	});

	test('stores only the SHA-256 hash of a token', async () => {
		const { token } = await setup();
		const [device] = store.liveDevices();
		expect(device!.tokenHash).toBe(await sha256(token));
		expect(JSON.stringify(store.liveDevices())).not.toContain(token);
	});

	test('protected routes need a live bearer token', async () => {
		for (const token of [undefined, 'made-up']) {
			expect((await call(env, 'POST', '/api/auth/pair', undefined, token)).status).toBe(401);
			expect((await call(env, 'GET', '/api/auth/devices', undefined, token)).status).toBe(401);
			expect((await call(env, 'DELETE', '/api/auth/devices', { id: 'x' }, token)).status).toBe(401);
		}
	});

	test('a pairing code is eight unambiguous characters valid for ten minutes', async () => {
		const { token } = await setup();
		const { code, expiresAt } = await pair(token);
		expect(code).toHaveLength(8);
		expect([...code].every(char => PAIRING_ALPHABET.includes(char))).toBe(true);
		expect(expiresAt).toBe(NOW + PAIRING_TTL_MS);
	});

	test('redeeming a code pairs a second device, once, and ignores case and dashes', async () => {
		const first = await setup();
		const { code } = await pair(first.token);
		setSystemTime(NOW + 1000);
		const response = await redeem(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`);
		expect(response.status).toBe(200);
		const second = (await response.json()) as DeviceCredentials;
		expect(second.deviceId).not.toBe(first.deviceId);
		const { body } = await devices(second.token);
		expect(body.devices.map(device => [device.name, device.current])).toEqual([
			['Mac', false],
			['iPhone', true],
		]);
		expect((await redeem(code)).status).toBe(401);
	});

	test('a code expires after ten minutes', async () => {
		const { token } = await setup();
		const { code } = await pair(token);
		setSystemTime(NOW + PAIRING_TTL_MS);
		expect((await redeem(code)).status).toBe(401);
		expect(store.pairing()).toBeNull();
	});

	test('five wrong guesses burn the code', async () => {
		const { token } = await setup();
		const { code } = await pair(token);
		const wrong = code === 'AAAAAAAA' ? 'BBBBBBBB' : 'AAAAAAAA';
		for (let attempt = 0; attempt < 4; attempt++) expect((await redeem(wrong)).status).toBe(401);
		expect(store.pairing()?.attempts).toBe(4);
		expect((await redeem(wrong)).status).toBe(401);
		expect(store.pairing()).toBeNull();
		expect((await redeem(code)).status).toBe(401);
	});

	test('a new code replaces the previous one', async () => {
		const { token } = await setup();
		const old = await pair(token);
		const current = await pair(token);
		if (old.code !== current.code) expect((await redeem(old.code)).status).toBe(401);
		expect((await redeem(current.code)).status).toBe(200);
	});

	test('requests update last seen', async () => {
		const { token } = await setup();
		setSystemTime(NOW + 5000);
		const { body } = await devices(token);
		expect(body.devices[0]!.lastSeenAt).toBe(NOW + 5000);
	});

	test('revoking a device kills its token at once and hides it from the list', async () => {
		const first = await setup();
		const second = await setup('Laptop');
		const response = await call(env, 'DELETE', '/api/auth/devices', { id: second.deviceId }, first.token);
		expect(response.status).toBe(200);
		expect((await devices(second.token)).status).toBe(401);
		expect((await devices(first.token)).body.devices.map(device => device.id)).toEqual([first.deviceId]);
		expect((await call(env, 'DELETE', '/api/auth/devices', { id: second.deviceId }, first.token)).status).toBe(404);
	});

	test('a device can revoke itself', async () => {
		const { deviceId, token } = await setup();
		expect((await call(env, 'DELETE', '/api/auth/devices', { id: deviceId }, token)).status).toBe(200);
		expect((await devices(token)).status).toBe(401);
	});
});
