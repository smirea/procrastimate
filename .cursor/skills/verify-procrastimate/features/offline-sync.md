# Offline and sync

Procrastimate works fully without a network. Every change applies locally at once and syncs in the background, so web and iOS show the same tasks once both are online.

## Sub-features

- `sync-offline` keeps every feature working with no network.
- `sync-propagate` shows a change from one client on the other.
- `sync-reconnect` uploads offline changes after the network returns.
- `sync-conflict` converges when both clients change the same task offline.

## How to get to it (user POV)

- Sync has no screen. Stefan uses any feature on either client and expects the other client to match.
- Planned: a quiet indicator shows when a client is offline or has changes waiting to sync.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with the web client and the iOS simulator pointed at the same disposable server store.
- iOS steps need macOS. On Linux, use two separate browser profiles as the two clients.

- **Propagate.** Planned: add `Synced task` on the web. It appears on iOS without a manual refresh.
- **Offline.** Planned: stop the server, then add, complete, and edit tasks on the web. Each change applies at once with no error.
- **Reconnect.** Planned: start the server again. The offline changes appear on iOS.
- **Conflict.** Planned: take both clients offline, rename the same task differently on each, then reconnect both. Both clients settle on the same title.
- **Proof.** Planned: capture both clients side by side after each step.

## Gotchas

- Stopping the server is the offline test for the web client. Browser offline mode can also block the dev server and break the page.
- A change that shows only on the client that made it proves local state, not sync.
- Each field keeps the write with the later hybrid logical clock, so the title renamed last wins. See `docs/decisions/sync.md`.
