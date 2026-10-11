/** The Worker sets this after it has checked the session. Account objects trust it and ignore a client-supplied value. */
export const USER_HEADER = 'x-procrastimate-user';

/** This install's id. It is not a secret: the session is the credential. */
export const DEVICE_HEADER = 'x-procrastimate-device';

/** A display name stored with the device. It is never shown. */
export const DEVICE_NAME_HEADER = 'x-procrastimate-device-name';
