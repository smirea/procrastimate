import type { z } from 'zod';
import { INSTALL_GATE, registerRequestSchema, type RegisteredDevice } from '../../shared/auth';
import { SOCKET_TOKEN_PREFIX } from '../../shared/sync/protocol';
import type { Ramble } from './account/ramble';
import type { Realtime } from './account/realtime';
import type { AccountStore } from './account/store';

/**
 * Device auth for sync. Nothing else reads tokens. An install registers its own secret; there is no setup code
 * and no pairing.
 */

/** What an account route sees. `setAlarm` arms the object's one alarm, or clears it with null. */
export type AccountContext = {
	store: AccountStore;
	now: number;
	setAlarm: (at: number | null) => Promise<void>;
	realtime: Realtime;
	ramble: Ramble;
};

export type AccountRoute = (request: Request, context: AccountContext) => Promise<Response>;

const encoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The `Authorization: Bearer` token, or on a WebSocket upgrade from a browser, the `bearer.<token>` subprotocol. */
function bearerToken(request: Request): string | null {
	const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '');
	if (match) return match[1]!;
	const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(value => value.trim());
	const protocol = protocols.find(value => value.startsWith(SOCKET_TOKEN_PREFIX));
	return protocol ? protocol.slice(SOCKET_TOKEN_PREFIX.length) || null : null;
}

/** The id of the device whose live token the request carries, or null. Marks the device as seen. */
export async function authenticate(request: Request, { store, now }: AccountContext): Promise<string | null> {
	const token = bearerToken(request);
	if (!token) return null;
	const device = store.deviceByTokenHash(await sha256(token));
	if (!device || device.revokedAt !== null) return null;
	store.touchDevice(device.id, now);
	return device.id;
}

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	const parsed = schema.safeParse(await request.json().catch(() => undefined));
	return parsed.success ? parsed.data : null;
}

export const authRoutes: Record<string, AccountRoute> = {
	'POST /api/auth/register': async (request, { store, now }) => {
		const body = await parseBody(request, registerRequestSchema);
		if (!body) return fail(400, 'Invalid register request');
		// Comparing digests keeps the comparison time independent of how much of the gate matched.
		if ((await sha256(body.gate)) !== (await sha256(INSTALL_GATE))) return fail(401, 'Not signed in');
		const tokenHash = await sha256(body.token);
		const existing = store.deviceByTokenHash(tokenHash);
		if (existing) {
			if (existing.revokedAt !== null) return fail(401, 'Not signed in');
			store.touchDevice(existing.id, now);
			return Response.json({ ok: true, deviceId: existing.id } satisfies RegisteredDevice);
		}
		const deviceId = store.hasDevice(body.deviceId) ? crypto.randomUUID() : body.deviceId;
		store.addDevice({
			id: deviceId,
			name: body.name,
			tokenHash,
			createdAt: now,
			lastSeenAt: now,
			revokedAt: null,
		});
		return Response.json({ ok: true, deviceId } satisfies RegisteredDevice);
	},
};
