import { z } from 'zod';

/** Pairing codes avoid 0, O, 1, and I so they read unambiguously. 32 symbols keep random picks unbiased. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_ATTEMPTS = 5;

/** Uppercases and drops spaces and dashes, so `abcd-efgh` and `ABCD EFGH` are the same code. */
export const normalizePairingCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

const deviceName = z.string().trim().min(1).max(60);

/** `POST /api/auth/setup`: the first device proves it knows the `SYNC_SETUP_CODE` secret. */
export const setupRequestSchema = z.object({ code: z.string().min(1).max(200), name: deviceName });

/** `POST /api/auth/redeem`: a new device enters a pairing code shown on a paired one. */
export const redeemRequestSchema = z.object({ code: z.string().min(1).max(40), name: deviceName });

/** `DELETE /api/auth/devices` revokes one device's token. */
export const revokeRequestSchema = z.object({ id: z.string().min(1).max(100) });

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type RedeemRequest = z.infer<typeof redeemRequestSchema>;
export type RevokeRequest = z.infer<typeof revokeRequestSchema>;

/** Setup and redeem answer with the new device's id and its bearer token, which the server never shows again. */
export type DeviceCredentials = { ok: true; deviceId: string; token: string };

export type PairingCode = { ok: true; code: string; expiresAt: number };

export type DeviceInfo = { id: string; name: string; createdAt: number; lastSeenAt: number; current: boolean };

export type DeviceList = { ok: true; devices: DeviceInfo[] };
