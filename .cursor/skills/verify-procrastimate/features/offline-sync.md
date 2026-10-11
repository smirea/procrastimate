# Offline and sync

Procrastimate works fully without a network. Every change applies locally at once and syncs in the background. Sync is always on. Nothing in the UI mentions sync.

## Sub-features

- `sync-offline` keeps every feature working with no network. Changes wait in the outbox until the network returns.
- `sync-propagate` shows a change from one client on the other.
- `sync-realtime` brings that change over at once while the other client is open and visible, through the server's nudge socket, with no focus or timer.
- `sync-reconnect` uploads offline changes after the network returns.
- `sync-conflict` converges when both clients change the same task offline.
- `sync-delete` wipes tasks, projects, and labels on this device and the server from Settings, `Delete all data`.

## How to get to it (user POV)

- There is no Sync screen. Stefan uses any feature on either client and expects the other client to match. A client syncs on launch, on focus or foreground, when the network returns, one second after each change, every minute while visible, and as soon as the server's realtime socket says another device changed something.
- `Settings`, then `Delete all data`, then confirm, to empty tasks, projects, and labels on this device and the server.

## Driving it with control-ui and XCUITest

Preconditions:

- Two clients: on Linux, two separate browser profiles. The iOS sync client is in Core; macOS XCUITest of two devices is not part of this check.
- Automated proof: `bun run test:e2e -- e2e/sync.e2e.ts`. It opens two browser contexts against the dev server's in-memory account, or the Worker's with `E2E_WORKER=1`. Each context registers on its own.

- **Propagate.** Add a task on A. It appears on B after B regains focus or within a minute. Completing it on B removes it from A's Inbox. Test: `a change on one device shows on the other`.
- **Realtime.** With A and B both open and nothing focusing B, add a task on A. B shows it within a couple of seconds. Completing it on B removes it from A the same way. In devtools, B's Network tab shows one WebSocket to `/api/sync/socket` with a `{"cursor":N}` frame per change. Test: `a change on one device shows on the other at once, without focus or the minute timer`.
- **Offline.** Block A's `/api/sync` requests. Add and rename tasks on A. Each change applies at once and survives a reload. Test: `changes made offline apply at once and upload when the network returns`.
- **Reconnect.** Let A's requests through again. B shows the new and renamed tasks. Same test.
- **Conflict.** Block both clients, rename the same task differently on each, and add notes on B. After both reconnect, both show the same title (the later write wins) and B's notes, since different fields merge. Test: `both devices editing the same task offline converge`.
- **Delete all.** On A, `Settings`, `Delete all data`, confirm. A's tasks are gone and stay gone after a reload. B's tasks are gone once it syncs, and its waiting edits are dropped. Both devices keep their tokens. Test: `delete all data clears this device and the other`.
- **iOS.** The Core store writes a sync section on first launch and queues local changes. `swift test` covers that. There is no macOS XCUITest of two devices.

## Gotchas

- The e2e tests block only `/api/sync` to go offline. Browser offline mode also cuts the page off from the dev server. The `**/api/sync` route does not match `/api/sync/socket`, so an "offline" device still hears nudges and its syncs fail.
- The socket goes through Vite's `/api` proxy with `ws: true` in dev. The socket only triggers syncs, so a change that shows only after focus means the socket is down.
- The tests share one in-memory account, so they run one at a time. `--repeat-each` needs `--workers=1`.
- The pinned e2e clock is days ahead of the server, which then replaces the clients' clocks with its own, so the write that reaches the server last wins a conflict. The test only asserts that both clients agree.
- Completing a task commits 260 ms after the click, after the check animation.
- A change that shows only on the client that made it proves local state, not sync.
- The token lives under the `procrastimate-device` `localStorage` key, outside the `procrastimate` document. The document always has a `sync` section.
