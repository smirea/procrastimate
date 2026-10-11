/**
 * Every install sends this when it registers. It is not a setup code and it never appears in the UI. It only
 * rejects a client that is not this app. The value ships in the client, so someone who reads the bundle can
 * register a device; the device token then gates every later request. That is the whole lock for one user
 * with nothing to type. The value lives in `install-gate.mjs` so the end-to-end runner can load it.
 */
export const INSTALL_GATE: string;
