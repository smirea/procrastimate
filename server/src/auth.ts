import { DEVICE_HEADER, DEVICE_NAME_HEADER, type Actor } from '../../shared/auth';
import type { ShareRow } from '../../shared/db/schema';
import { DEVICE_PROTOCOL_PREFIX } from '../../shared/sync/protocol';
import type { InternalClient } from './account/peers';
import type { Ramble } from './account/ramble';
import type { Realtime } from './account/realtime';
import type { AccountStore } from './account/store';

/**
 * Sync auth. The Worker has already checked the session or API token and set `x-procrastimate-actor`. The device
 * id is the install's own id, not a secret. The stored hash only satisfies the column; it is not a credential.
 */

/** The owner of the space, or a guest with the space's live shares to them. */
export type Access = { role: 'owner' } | { role: 'guest'; shares: ShareRow[] };

/**
 * What an account route sees. `setAlarm` arms the object's one alarm, or clears it with null. `defer` runs a task
 * after the request leaves the object's serial queue, which is where every call to another space goes, so two
 * spaces that share with each other cannot wait on one another. `peer` reaches another space's internal routes.
 */
export type AccountContext = {
	store: AccountStore;
	now: number;
	setAlarm: (at: number | null) => Promise<void>;
	realtime: Realtime;
	ramble: Ramble;
	/** The space's owner id, which names the object. */
	space: string;
	actor: Actor;
	access: Access;
	/** The request's origin, for the links the space hands out. */
	origin: string;
	defer: (task: () => Promise<void>) => void;
	peer: (spaceId: string) => InternalClient | null;
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
 * The id of the owner's device, creating the row on first use. A revoked device stays revoked. Returns null when
 * the actor is not the space's owner, or the request names no device.
 */
export async function authenticate(
	request: Request,
	{ store, now, actor, access }: AccountContext,
): Promise<string | null> {
	const deviceId = deviceIdFrom(request);
	if (access.role !== 'owner' || !deviceId) return null;
	const userId = actor.id;
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
