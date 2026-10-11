# Sync account and auth

How the server side of [Sync](sync.md) stores the one account and lets devices in. The protocol and conflict rules are in that file.

- **One `Account` Durable Object.** There is one account, so every account route goes to the object named `account`. It is SQLite-backed, on the free plan, and runs one request at a time.
- **A synchronous store interface.** `server/src/account/store.ts` defines `AccountStore` over the `entities`, `log`, `devices`, and `meta` tables. Its methods are synchronous like Durable Object SQLite, so a request does its async work (hashing) first and then reads and writes without another request interleaving. The Worker uses the SQLite store when Turso is unset, and loads into memory when it is set. The Bun dev server uses an in-memory store that is lost on restart, so local dev and Playwright need no `wrangler`. Tests run the SQLite store on `bun:sqlite`.
- **Auth is one file.** `server/src/auth.ts` is the only code that reads tokens. Other account routes call its `authenticate`, which returns the device id or null and marks the device as seen.
- **Register.** `POST /api/auth/register` takes `{ gate, deviceId, token, name }`. The gate must match `INSTALL_GATE` in `shared/auth.ts`. A wrong or missing gate is `401` or `400`. The server stores the SHA-256 of the token. Sending the same token again returns the same device id. A device id that is already stored gets a new one. There is no setup, pairing, redeem, or device-list route.
- **Tokens.** The client makes the token, sends it as `Authorization: Bearer`, or on the realtime WebSocket from a browser as the `bearer.<token>` subprotocol (see [Sync](sync.md#realtime-nudge)). The server stores only the hash.
- **Task storage.** With both Turso secrets set, `openAccount` loads the rows into the in-memory store and flushes them at the end of the request. Otherwise the Worker uses Durable Object SQLite and Bun uses memory. Devices and the epoch live in the same rows as the tasks.
- **Shared contracts.** The register schema is in `shared/auth.ts`.
