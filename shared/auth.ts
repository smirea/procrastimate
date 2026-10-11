import { z } from 'zod';
import { INSTALL_GATE } from './install-gate.mjs';

export { INSTALL_GATE };

const deviceName = z.string().trim().min(1).max(60);

/** `POST /api/auth/register`: an install presents its own token. The server stores only the hash. */
export const registerRequestSchema = z.object({
	gate: z.string(),
	deviceId: z.string().trim().min(1).max(80),
	token: z.string().trim().min(16).max(200),
	name: deviceName,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** The server confirms the device id it stored, which is the one the install sent unless that id was taken. */
export type RegisteredDevice = { ok: true; deviceId: string };
