import { DEVICE_HEADER, DEVICE_NAME_HEADER } from '../../../shared/auth';
import type { Person } from '../../../shared/sharing';
import api from '../api';
import type { Env } from '../bindings';

/** Shared by unit tests. Production never uses it; an unset secret keeps sign-in off. */
export const TEST_AUTH_SECRET = 'test-better-auth-secret-0123456789';

export type DeviceCredentials = { deviceId: string; token: string; cookie: string };

const sessions = new WeakMap<Env, Promise<{ token: string; cookie: string }>>();

/** Puts the test secret on `env` when the caller did not, so later requests on the same object stay signed in. */
export function withAuth(env: Env): Env {
	if (!env.BETTER_AUTH_SECRET && !env.E2E_SHARD) env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET;
	return env;
}

async function signUp(env: Env): Promise<{ token: string; cookie: string }> {
	const response = await api.fetch(
		new Request('https://procrastimate.test/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://procrastimate.test' },
			body: JSON.stringify({
				email: `user-${crypto.randomUUID()}@procrastimate.test`,
				password: 'test-password-1',
				name: 'Test',
			}),
		}),
		env,
	);
	if (!response.ok) throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
	const token = response.headers.get('set-auth-token');
	if (!token) throw new Error('sign-up did not return a session token');
	const cookie = response.headers
		.getSetCookie()
		.map(value => value.split(';')[0])
		.join('; ');
	return { token, cookie };
}

function sessionFor(env: Env) {
	const existing = sessions.get(env);
	if (existing) return existing;
	const created = signUp(env);
	sessions.set(env, created);
	return created;
}

export async function registerDevice(env: Env, name = 'Device'): Promise<DeviceCredentials> {
	withAuth(env);
	const session = await sessionFor(env);
	const deviceId = crypto.randomUUID();
	const response = await api.fetch(
		new Request('https://procrastimate.test/api/sync', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'https://procrastimate.test',
				Authorization: `Bearer ${session.token}`,
				[DEVICE_HEADER]: deviceId,
				[DEVICE_NAME_HEADER]: name,
			},
			body: JSON.stringify({ cursor: 0, ops: [] }),
		}),
		env,
	);
	if (!response.ok) throw new Error(`device sync failed: ${response.status} ${await response.text()}`);
	return { deviceId, token: session.token, cookie: session.cookie };
}

export function authHeaders(credentials: Pick<DeviceCredentials, 'token' | 'deviceId'>): Record<string, string> {
	return { Authorization: `Bearer ${credentials.token}`, [DEVICE_HEADER]: credentials.deviceId };
}

/** The signed-in user behind `credentials`, from `GET /api/me`. */
export async function whoAmI(env: Env, credentials: Pick<DeviceCredentials, 'token' | 'deviceId'>): Promise<Person> {
	const response = await api.fetch(
		new Request('https://procrastimate.test/api/me', { headers: authHeaders(credentials) }),
		env,
	);
	if (!response.ok) throw new Error(`me failed: ${response.status} ${await response.text()}`);
	return (await response.json()) as Person;
}
