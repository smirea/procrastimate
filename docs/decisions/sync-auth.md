# Sync account and auth

How the server side of [Sync](sync.md) stores the one account and lets devices in. The protocol and conflict rules are in that file.

- **One `Account` Durable Object.** There is one account, so every account route goes to the object named `account`. It is SQLite-backed, on the free plan, and runs one request at a time.
- **A synchronous store interface.** `server/src/account/store.ts` defines `AccountStore` over the `entities`, `log`, `devices`, and `pairing` tables. Its methods are synchronous like Durable Object SQLite, so a request does its async work (hashing) first and then reads and writes without another request interleaving. The Worker uses the SQLite store. The Bun dev server uses an in-memory store that is lost on restart, so local dev and Playwright need no `wrangler`. Tests run the SQLite store on `bun:sqlite`.
- **Auth is one file.** `server/src/auth.ts` is the only code that reads tokens. Other account routes call its `authenticate`, which returns the device id or null and marks the device as seen. Passkeys can replace the setup code by changing that file and the pairing screen.
- **Setup.** `POST /api/auth/setup` with the `SYNC_SETUP_CODE` secret and a device name issues a device. It works any time, which doubles as recovery if every device is lost. Without the secret it answers `503`, so sync is simply off. The secret's handling is in [Production hosting](production-hosting.md).
- **Pairing.** `POST /api/auth/pair` from a paired device makes an eight-character code from a 32-symbol alphabet without `0`, `O`, `1`, or `I`, valid for ten minutes. Only one code is live, and a new one replaces it. `POST /api/auth/redeem` ignores case, spaces, and dashes. Every wrong guess counts against the live code, and the fifth burns it.
- **Tokens.** 32 random bytes, base64url, sent as `Authorization: Bearer`. The server stores only their SHA-256 hash and shows a token once, when it is issued.
- **Devices.** `GET /api/auth/devices` lists live devices oldest first, with `current` marking the caller. `DELETE /api/auth/devices` revokes one at once, the caller included. A revoked device keeps its row with `revoked_at` and drops out of the list.
- **Shared contracts.** Request schemas and response types are in `shared/auth.ts`, so the web and iOS clients use the same shapes.
