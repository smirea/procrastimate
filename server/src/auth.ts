import type { z } from 'zod';
import {
	normalizePairingCode,
	PAIRING_ALPHABET,
	PAIRING_ATTEMPTS,
	PAIRING_CODE_LENGTH,
	PAIRING_TTL_MS,
	redeemRequestSchema,
	revokeRequestSchema,
	setupRequestSchema,
	type DeviceCredentials,
	type DeviceList,
	type PairingCode,
} from '../../shared/auth';
import type { AccountStore } from './account/store';

/**
 * Device auth for sync. Nothing else reads tokens, so passkeys can replace the setup code by changing this file and
 * the pairing screen. Everything here runs inside the `Account` object, against its store.
 */

/** What an account route sees. `setupCode` is undefined when the `SYNC_SETUP_CODE` secret is not set. */
export type AccountContext = { store: AccountStore; setupCode: string | undefined; now: number };

export type AccountRoute = (request: Request, context: AccountContext) => Promise<Response>;

const TOKEN_BYTES = 32;

const encoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
}

function newPairingCode(): string {
	// 32 symbols divide 256 evenly, so masking a byte keeps every symbol equally likely.
	const bytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH));
	return Array.from(bytes, byte => PAIRING_ALPHABET[byte & 31]).join('');
}

function bearerToken(request: Request): string | null {
	const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '');
	return match?.[1] ?? null;
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

/** Hashing happens before any store access, so issuing is synchronous and can sit inside a transaction. */
async function prepareDevice(name: string, now: number) {
	const token = newToken();
	const device = { id: crypto.randomUUID(), name, tokenHash: await sha256(token), createdAt: now, lastSeenAt: now };
	return {
		issue(store: AccountStore): DeviceCredentials {
			store.addDevice({ ...device, revokedAt: null });
			return { ok: true, deviceId: device.id, token };
		},
	};
}

function authenticated(route: (request: Request, context: AccountContext, deviceId: string) => Promise<Response>) {
	return async (request: Request, context: AccountContext) => {
		const deviceId = await authenticate(request, context);
		return deviceId ? route(request, context, deviceId) : fail(401, 'Not signed in');
	};
}

export const authRoutes: Record<string, AccountRoute> = {
	'POST /api/auth/setup': async (request, { store, setupCode, now }) => {
		if (!setupCode) return fail(503, 'Sync is not configured');
		const body = await parseBody(request, setupRequestSchema);
		if (!body) return fail(400, 'Invalid setup request');
		// Comparing digests keeps the comparison time independent of how much of the code matched.
		if ((await sha256(body.code)) !== (await sha256(setupCode))) return fail(401, 'Wrong setup code');
		const device = await prepareDevice(body.name, now);
		return Response.json(device.issue(store));
	},

	'POST /api/auth/pair': authenticated(async (_request, { store, now }) => {
		const code = newPairingCode();
		const expiresAt = now + PAIRING_TTL_MS;
		store.setPairing({ codeHash: await sha256(code), expiresAt, attempts: 0 });
		return Response.json({ ok: true, code, expiresAt } satisfies PairingCode);
	}),

	'POST /api/auth/redeem': async (request, { store, now }) => {
		const body = await parseBody(request, redeemRequestSchema);
		if (!body) return fail(400, 'Invalid pairing request');
		const codeHash = await sha256(normalizePairingCode(body.code));
		const device = await prepareDevice(body.name, now);
		const credentials = store.transaction(() => {
			const pairing = store.pairing();
			if (!pairing) return null;
			if (pairing.expiresAt <= now) {
				store.setPairing(null);
				return null;
			}
			if (pairing.codeHash !== codeHash) {
				const attempts = pairing.attempts + 1;
				store.setPairing(attempts >= PAIRING_ATTEMPTS ? null : { ...pairing, attempts });
				return null;
			}
			store.setPairing(null);
			return device.issue(store);
		});
		return credentials ? Response.json(credentials) : fail(401, 'Invalid or expired code');
	},

	'GET /api/auth/devices': authenticated(async (_request, { store }, deviceId) => {
		const devices = store.liveDevices().map(device => ({
			id: device.id,
			name: device.name,
			createdAt: device.createdAt,
			lastSeenAt: device.lastSeenAt,
			current: device.id === deviceId,
		}));
		return Response.json({ ok: true, devices } satisfies DeviceList);
	}),

	'DELETE /api/auth/devices': authenticated(async (request, { store, now }) => {
		const body = await parseBody(request, revokeRequestSchema);
		if (!body) return fail(400, 'Invalid device');
		return store.revokeDevice(body.id, now) ? Response.json({ ok: true }) : fail(404, 'No such device');
	}),
};
