import { z } from 'zod';

/**
 * Every install sends this when it registers. It is not a setup code and it never appears in the UI. It only
 * rejects a client that is not this app. The value ships in the client, so someone who reads the bundle can
 * register a device; the device token then gates every later request. That is the whole lock for one user
 * with nothing to type.
 */
export const INSTALL_GATE = 'procrastinate-install-v1';

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
