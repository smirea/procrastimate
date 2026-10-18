import { DEVICE_HEADER } from '../../shared/auth';
import type { ShareRow } from '../../shared/db/schema';

/** The owner of the space, or a guest with the space's live shares to them. */
export type Access = { role: 'owner' } | { role: 'guest'; shares: ShareRow[] };

const encoder = new TextEncoder();
const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;
/** A browser WebSocket cannot set headers, so Ramble's socket names the install in a `device.<id>` subprotocol. */
const DEVICE_PROTOCOL_PREFIX = 'device.';

export async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The install id from the header, or on a browser WebSocket from the `device.<id>` subprotocol. It is not a secret. */
export function deviceIdFrom(request: Request): string | null {
	const header = request.headers.get(DEVICE_HEADER);
	if (header && DEVICE_ID.test(header)) return header;
	const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(value => value.trim());
	const protocol = protocols.find(value => value.startsWith(DEVICE_PROTOCOL_PREFIX));
	const id = protocol ? protocol.slice(DEVICE_PROTOCOL_PREFIX.length) : '';
	return DEVICE_ID.test(id) ? id : null;
}
