import { DEVICE_HEADER, DEVICE_NAME_HEADER, USER_HEADER } from '../../shared/auth';
import { DEVICE_PROTOCOL_PREFIX } from '../../shared/sync/protocol';
import type { Ramble } from './account/ramble';
import type { Realtime } from './account/realtime';
import type { AccountStore } from './account/store';

/**
 * Sync auth. The Worker has already checked the Better Auth session and set `x-procrastimate-user`. The device id
 * is the install's own id, not a secret. The stored hash only satisfies the column; it is not a credential.
 */

/** What an account route sees. `setAlarm` arms the object's one alarm, or clears it with null. */
export type AccountContext = {
	store: AccountStore;
	now: number;
	setAlarm: (at: number | null) => Promise<void>;
	realtime: Realtime;
	ramble: Ramble;
};

/** A route outside the contract: a WebSocket upgrade. */
export type AccountRoute = (request: Request, context: AccountContext) => Promise<Response>;

const encoder = new TextEncoder();
const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;

export async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The install id from the header, or on a browser WebSocket from the `device.<id>` subprotocol. */
export function deviceIdFrom(request: Request): string | null {
	const header = request.headers.get(DEVICE_HEADER);
	if (header && DEVICE_ID.test(header)) return header;
	const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(value => value.trim());
	const protocol = protocols.find(value => value.startsWith(DEVICE_PROTOCOL_PREFIX));
	const id = protocol ? protocol.slice(DEVICE_PROTOCOL_PREFIX.length) : '';
	return DEVICE_ID.test(id) ? id : null;
}

/**
 * The id of the signed-in user's device, creating the row on first use. A revoked device stays revoked.
 * Returns null when the Worker did not attach a user, or the request names no device.
 */
export async function authenticate(request: Request, { store, now }: AccountContext): Promise<string | null> {
	const userId = request.headers.get(USER_HEADER);
	const deviceId = deviceIdFrom(request);
	if (!userId || !deviceId) return null;
	const live = store.liveDevices().find(device => device.id === deviceId);
	if (live) {
		store.touchDevice(deviceId, now);
		return deviceId;
	}
	if (store.hasDevice(deviceId)) return null;
	const name = (request.headers.get(DEVICE_NAME_HEADER) ?? 'Device').slice(0, 80);
	store.addDevice({
		id: deviceId,
		name,
		tokenHash: await sha256(`${userId}:${deviceId}`),
		createdAt: now,
		lastSeenAt: now,
		revokedAt: null,
	});
	return deviceId;
}
