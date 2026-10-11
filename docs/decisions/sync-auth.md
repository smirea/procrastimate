# Sync account and auth

How the server side of [Sync](sync.md) stores the one account and lets devices in. The protocol and conflict rules are in that file.

- **One `Account` Durable Object per user.** The object name is the user id. It is SQLite-backed, on the free plan, and runs one request at a time.
- **A synchronous store interface.** `server/src/account/store.ts` defines `AccountStore` over the `entities`, `log`, `devices`, and `meta` tables. Its methods are synchronous like Durable Object SQLite, so a request does its async work (hashing) first and then reads and writes without another request interleaving. The Worker uses the SQLite store when Turso is unset, and loads into memory when it is set. The Bun dev server uses an in-memory store that is lost on restart, so local dev and Playwright need no `wrangler`. Tests run the SQLite store on `bun:sqlite`.
- **Auth.** `server/src/better-auth.ts` checks the session. `server/src/auth.ts` turns that user and the device id into the device row. Other account routes call `authenticate`, which returns the device id or null.
- **Session.** Sync routes require a Better Auth session. The device id names the install and is not a credential. See [Auth](auth.md).
- **Credential.** The web sends the session cookie. iOS sends `Authorization: Bearer` with the Keychain token. The device id travels in `x-procrastinate-device`, or on a browser WebSocket as the `device.` subprotocol.
- **Task storage.** With both Turso secrets set, `openAccount` loads the rows into the in-memory store and flushes them at the end of the request. Otherwise the Worker uses Durable Object SQLite and Bun uses memory. Devices and the epoch live in the same rows as the tasks.
- **Shared contracts.** The user and device headers are in `shared/auth.ts`.
