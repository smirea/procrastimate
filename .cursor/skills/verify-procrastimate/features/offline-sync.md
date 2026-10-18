# Offline and sync

ProcrastiMate works fully without a network. Every change applies locally at once and syncs in the background. Sync is always on and live. Nothing in the UI mentions sync, except a toast when the server rejects a change and pull to refresh on iOS.

## Sub-features

- `sync-offline` keeps every feature working with no network. Changes wait in PowerSync's upload queue in the local database until the network returns, and the data survives a reload.
- `sync-propagate` shows a change from one client on the other.
- `sync-realtime` brings that change over at once while both clients are open: PowerSync streams it, with no focus, timer, or reload.
- `sync-reconnect` uploads offline changes after the network returns.
- `sync-conflict` converges when both clients change the same task offline: each field keeps the write that reached the server last.
- `sync-delete-wins` keeps a deleted task deleted when an edit made before the delete reaches the server after it.
- `sync-rejected` handles a write the server refuses: the rest of the upload still applies, the row goes back to the server's value at the next checkpoint, and a toast says "Couldn’t save a change to “Title”". The device keeps syncing.
- `sync-refresh` on iOS: pulling down any task list (Inbox, No date, a project, label, place, or event, Completed) or Browse reconnects PowerSync if its stream dropped, reloads the people cache, and the spinner stays until the stream is idle, at most five seconds.
- `sync-delete` wipes tasks, projects, and labels on this device and the server from Settings, `Delete all data`.

## How to get to it (user POV)

- There is no Sync screen. Stefan uses any feature on either client and expects the other client to match. The web connects while signed in and streams every change both ways; there is no focus trigger, timer, or pull to refresh.
- `Settings`, then `Delete all data`, then confirm, to empty tasks, projects, and labels on this device and the server.

## Driving it with control-ui and the simulator

Preconditions:

- Two clients: on Linux, two separate browser profiles. The iOS store and its row writes are in Core; the PowerSync client is `app-ios/Sources/App/Sync`.
- Automated proof: `bun run test:e2e -- e2e/sync.e2e.ts`, in the `desktop` (Chromium) and `mobile` (iPhone-sized WebKit) projects. It opens two browser contexts on one new account, against the worktree's Postgres and PowerSync, or the Worker with `E2E_WORKER=1`.

- **Propagate.** Add a task on A. It appears on B at once, locally in about 70 to 190 ms in Chromium and 120 to 170 ms in WebKit. Completing it on B removes it from A's Inbox the same way. Test: `a change on one device shows on the other at once, both ways`.
- **Closed at once.** Add a task and reload in the same moment, before the local database could write it. It is there after the reload and reaches B. Test: `a task added the moment before the page goes away is there after the reload`.
- **Tabs.** Two tabs of one browser share one local database. A task added in one shows in the other at once, and both reach B. Test: `two tabs of one browser share one database, and both upload`.
- **Offline.** Take A offline (Playwright's `context.setOffline(true)`, plus refusing `/api/powersync`, `/api/upload`, and `/api/sync/token`). Add and rename tasks on A. Each change applies at once and survives a reload while the sync routes stay refused. Test: `changes made offline apply at once, survive a reload, and upload when the network returns`.
- **Reconnect.** Bring A back. B shows the new and renamed tasks. Same test.
- **Typing.** Open a synced task on A, take A offline, and type into Notes. Each keystroke shows at once and queues one write. On reconnect the upload folds them into one patch with the full text, and B shows the notes. Test: `typing notes shows each keystroke at once and uploads one write with the last value`.
- **Rejected.** Make A's next upload carry a write the schema refuses: the test rewrites a rename's write in flight to `priority: 99`. A shows "Couldn’t save a change to “<new title>”", the row goes back to the old title, and A's next new task reaches B. Test: `an edit the server rejects goes back to the server value with a notice, and the device keeps syncing`. A guest's refusal is in [Sharing](./sharing.md). Server half: `bun test server/src/upload.test.ts`; iOS: `swift test` (`VectorTests` for `rejectionNotice`).
- **Conflict.** Take both clients offline, rename the same task differently on each, and add notes on B. After A and then B reconnect, both show B's title, since its write reached the server last, and B's notes. Test: `both devices editing the same task offline converge, each field to the last write`.
- **Delete wins.** Take B offline and rename a task there. Delete the task on A. When B reconnects, its rename changes nothing and the task is gone on both. Test: `a delete beats an edit that reaches the server after it`.
- **Switch users.** Sign out on A and sign back in with the sync routes refused: A's tasks are there, from the local database. Sign out and create another account: the list is empty, and what it adds never reaches A's account. Sign in as A again: A's tasks come back from the server. Test: `signing out keeps this device’s data, and signing in as someone else starts from an empty list`.
- **Delete all.** On A, `Settings`, `Delete all data`, confirm. A's tasks are gone and stay gone after a reload. B's are gone at once. Both stay signed in. Test: `delete all data clears this device and the other`.
- **Pull to refresh (iOS).** Drag any task list or Browse down past the top. A spinner shows under the bar and stays until the stream is idle; a change made on the web shows without it, about 0.1 s after the server takes it. Without a session (the DEBUG `PROCRASTIMATE_SIGNED_IN` launch) it ends at once.
- **iOS.** Each command hands its row writes to one serial writer into the PowerSync database, and every database change reloads the store (`StoreTests`, `SpaceTests`, and the `rows` vectors in `swift test`). `PROCRASTIMATE_OFFLINE=1` keeps sync disconnected for a launch: add a task, relaunch without it, and the task reaches the server.

## Gotchas

- Playwright's `context.route` never sees PowerSync's stream in Chromium, which runs it in a shared worker, so offline also uses `context.setOffline(true)`. A page cannot reload while the context is offline, so a reload test turns the network back on and keeps refusing the sync routes.
- Playwright contexts get `serviceWorkers: 'block'`: WebKit sends the page's requests through the push service worker, where `context.route` does not see them.
- The local database belongs to one account. Signing in as someone else clears it; signing out keeps it.
- A change that shows only on the client that made it proves local state, not sync. `window.procrastimate.pending()` counts the writes not on the server yet.
