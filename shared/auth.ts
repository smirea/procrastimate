import { z } from 'zod';
import type { Person } from './sharing.ts';
import { clientSchema } from './values.ts';

export { SERVER_ACTOR } from './values.ts';

/** Who makes the request, after the server checked the session or the API token. A human's email names them in Sentry. */
export type Actor = Person & { email?: string | null };

/** This install's id. It is not a secret: the session is the credential. */
export const DEVICE_HEADER = 'x-procrastimate-device';
/** The install id on a WebSocket, as a subprotocol, since a browser cannot set headers on one. */
export const DEVICE_PROTOCOL_PREFIX = 'device.';

/**
 * The app sending the request, as JSON (`Client`). The web and iOS send it on every request, and a request without
 * it is an `api` client. The server records it on each op the request writes.
 */
export const CLIENT_HEADER = 'x-procrastimate-client';
export const appClientSchema = clientSchema.extend({ kind: z.enum(['web', 'ios']) });

/** A display name stored with the device. It is never shown. */
export const DEVICE_NAME_HEADER = 'x-procrastimate-device-name';
