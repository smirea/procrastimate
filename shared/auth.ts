import { personSchema, type Person } from './sharing.ts';

export { SERVER_ACTOR } from './values.ts';

/** The Worker sets this after it has checked the session. Account objects trust it and ignore a client-supplied value. */
export const USER_HEADER = 'x-procrastimate-user';

/**
 * Who makes the request, as JSON (`Actor`). Only the Worker sets it, after checking the session or the API token;
 * a space's `Account` object trusts it and ignores a client-supplied value.
 */
export const ACTOR_HEADER = 'x-procrastimate-actor';
export const actorSchema = personSchema;
export type Actor = Person;

/** This install's id. It is not a secret: the session is the credential. */
export const DEVICE_HEADER = 'x-procrastimate-device';

/** A display name stored with the device. It is never shown. */
export const DEVICE_NAME_HEADER = 'x-procrastimate-device-name';
