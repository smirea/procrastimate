# Offline and sync

Procrastimate works fully without a network. Every change applies locally at once and syncs in the background, so every paired client shows the same tasks once it is online. Sync is opt in: an unpaired client never talks to the sync server and behaves as it always did.

## Sub-features

- `sync-pair` turns sync on: the first device with the setup code, every other with a pairing code from a paired one. See [Settings](./settings.md).
- `sync-offline` keeps every feature working with no network, and counts the changes waiting.
- `sync-propagate` shows a change from one client on the other.
- `sync-reconnect` uploads offline changes after the network returns.
- `sync-conflict` converges when both clients change the same task offline.
- `sync-remove` revokes a device from the device list, which turns sync off on it and keeps its tasks.

## How to get to it (user POV)

- `Settings`, then the `Sync` section: `Set up sync`, `Enter a pairing code`, or, once paired, the `Sync status` line, `Pair a device`, and the `Devices` list.
- After that sync has no screen. Stefan uses any feature on either client and expects the other client to match. A client syncs on launch, on focus, when the network returns, one second after each change, and every minute while visible.

## Driving it with control-ui and XCUITest

Preconditions:

- The server needs a setup code: set `SYNC_SETUP_CODE` in the root `.env.local`, run `env-manager gen --local`, and restart `bun run start`. The dev server's account lives in memory, so a restart empties it.
- Two clients: on Linux, two separate browser profiles. iOS steps need macOS.
- Automated proof: `bun run test:e2e -- e2e/sync.e2e.ts`. It opens two browser contexts against the dev server's in-memory account, or the Worker's with `E2E_WORKER=1`, both started with the setup code `e2e-setup-code`.

- **Pair.** On client A, `Set up sync`, enter the setup code, `Turn on sync`. `Sync status` reads `Up to date`. `Pair a device` shows an eight-character `Pairing code`. On client B, `Enter a pairing code`, type it in any case, `Pair`. B reads `Up to date`, A hides the code once B joins, and A's `Devices` list shows both, with `This device` on A. Test: `pairing shows the other device, and a change on one shows on the other`.
- **Propagate.** Add a task on A. It appears on B after B regains focus or within a minute. Completing it on B removes it from A's Inbox. Same test.
- **Offline.** Block A's `/api/sync` requests. Add and rename tasks on A. Each change applies at once, survives a reload, and `Sync status` reads `Offline · N changes waiting`. Test: `changes made offline apply at once and upload when the network returns`.
- **Reconnect.** Let A's requests through again. A reads `Up to date`, and B shows the new and renamed tasks. Same test.
- **Conflict.** Block both clients, rename the same task differently on each, and add notes on B. After both reconnect, both show the same title (the later write wins) and B's notes, since different fields merge. Test: `both devices editing the same task offline converge`.
- **Remove.** On A, `Remove` the row marked `This device`. A shows `Set up sync` again, keeps its tasks, and its `procrastimate-device` token and `sync` section are gone. Test: `removing a device turns sync off there and keeps its tasks`.
- **iOS.** Planned: pair the simulator with a code from the web and repeat Propagate.

## Gotchas

- The e2e tests block only `/api/sync` to go offline. Browser offline mode also cuts the page off from the dev server.
- Only one pairing code is live at a time and a new one replaces it, so tests that pair run one at a time (`test.describe.configure({ mode: 'default' })`). `--repeat-each` needs `--workers=1`.
- The pinned e2e clock is days ahead of the server, which then replaces the clients' clocks with its own, so the write that reaches the server last wins a conflict. The test only asserts that both clients agree.
- Completing a task commits 260 ms after the click, after the check animation. Wait for the row to leave before expecting `Up to date`.
- A change that shows only on the client that made it proves local state, not sync.
- The token lives under the `procrastimate-device` `localStorage` key, outside the `procrastimate` document. A document with a `sync` section but no token is unpaired on launch.
