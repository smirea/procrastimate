import { INSTALL_GATE } from '../../../shared/auth';
import api from '../api';
import type { Env } from '../bindings';

/** Registers an install the way a client does, and returns the token the client keeps. */
export async function registerDevice(env: Env, name = 'Device'): Promise<{ deviceId: string; token: string }> {
	const token = `token-${crypto.randomUUID()}`;
	const deviceId = crypto.randomUUID();
	const response = await api.fetch(
		new Request('https://procrastimate.test/api/auth/register', {
			method: 'POST',
			body: JSON.stringify({ gate: INSTALL_GATE, deviceId, token, name }),
		}),
		env,
	);
	if (!response.ok) throw new Error(await response.text());
	const body = (await response.json()) as { deviceId: string };
	return { deviceId: body.deviceId, token };
}
