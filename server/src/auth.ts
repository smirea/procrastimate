import { DEVICE_HEADER, DEVICE_PROTOCOL_PREFIX } from '../../shared/auth';
import type { ShareRow } from '../../shared/db/schema';

export type Access = { role: 'owner' } | { role: 'guest'; shares: ShareRow[] };

const encoder = new TextEncoder();
const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;

export async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function deviceIdFrom(request: Request): string | null {
	const header = request.headers.get(DEVICE_HEADER);
	if (header && DEVICE_ID.test(header)) return header;
	const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(value => value.trim());
	const protocol = protocols.find(value => value.startsWith(DEVICE_PROTOCOL_PREFIX));
	const id = protocol ? protocol.slice(DEVICE_PROTOCOL_PREFIX.length) : '';
	return DEVICE_ID.test(id) ? id : null;
}
