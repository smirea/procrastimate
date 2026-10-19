# Offline and sync

ProcrastiMate works fully without a network. Every change applies locally at once and syncs in the background. Sync is always on and live. The UI mentions sync only in a cloud on a task still waiting to upload, a notice in its details, a toast when the server rejects a change, and pull to refresh on iOS.

## Sub-features

- `sync-offline` keeps every feature working with no network. Changes wait in PowerSync's upload queue in the local database until the network returns, and the data survives a reload. On the web a reload or cold launch with no network opens from the cached shell, the database worker and its wasm included, even with the HTTP cache empty, and a connection that barely answers opens it within 1.5 s. Tests: `a cold launch offline opens the app from the cached shell`, `a launch on a connection that barely answers opens from the shell without waiting for it`.
- `sync-propagate` shows a change from one client on the other.
- `sync-realtime` brings that change over at once while both clients are open: PowerSync streams it, with no focus, timer, or reload.
- `sync-reconnect` uploads offline changes after the network returns.
- `sync-conflict` converges when both clients change the same task offline: each field keeps the write that reached the server last.
- `sync-delete-wins` keeps a deleted task deleted when an edit made before the delete reaches the server after it.
- `sync-rejected` handles a write the server refuses: the rest of the upload still applies, the row goes back to the server's value at the next checkpoint, and a toast says "Couldn’t save a change to “Title”". The device keeps syncing.
- `sync-refresh` on iOS: pulling down any task list (Inbox, No date, a project, label, place, or event, Completed) or Browse reconnects PowerSync if its stream dropped, reloads the people cache, and the spinner stays until the stream is idle, at most five seconds.
- `sync-unsynced` marks a task whose write waits in the upload queue: a cloud with an up arrow at the end of its row (`Not synced yet`), and `Not saved yet. Will sync when online.` floating above the title in its details. Offline it shows at once; online only after its oldest queued write waited 3 seconds, so a normal upload, or notes typed while each keystroke uploads, never flashes it. It leaves once the upload lands. Tests: `a change waiting to upload shows a cloud on its row and a notice in its details, at once offline and after a grace online`, `typing notes online for longer than the grace never marks the task unsynced`.
- `sync-delete` wipes tasks, projects, and labels on this device and the server from Settings, `Delete all data`.

## How to get to it (user POV)

- There is no Sync screen. Stefan uses any feature on either client and expects the other client to match. The web connects while signed in and streams every change both ways; there is no focus trigger, timer, or pull to refresh.
- `Settings`, then `Delete all data`, then confirm, to empty tasks, projects, and labels on this device and the server.

## Driving it with control-ui and the simulator

Preconditions:

- Two clients: on Linux, two separate browser profiles. The iOS store and its row writes are in Core; the PowerSync client is `app-ios/Sources/App/Sync`.
- Automated proof: `bun run test:e2e -- e2e/sync.e2e.ts`, in the `desktop` (Chromium) and `mobile` (iPhone-sized WebKit) projects. It opens two browser contexts on one new account, against the worktree's Postgres and PowerSync, or the Worker with `E2E_WORKER=1`.

- **Propagate.** Add a task on A. It appears on B at once, locally in about 70 to 190 ms in Chromium and 120 to 170 ms in WebKit. Completing it on B removes it from A's Inbox the same way. Test: `a change on one device shows on the other at once, both ways`.
- **Reloaded at once.** Add a task and reload in the same moment, before the local database could write it. It is there after the reload and reaches B. Test: `a task added the moment before the page goes away is there after the reload`.
- **Tabs.** Two tabs of one browser share one local database. A task added in one shows in the other at once, and both reach B. Test: `two tabs of one browser share one database, and both upload`.
- **Offline.** Take A offline (Playwright's `context.setOffline(true)`, plus refusing `/api/powersync`, `/api/upload`, and `/api/sync/token`). Add and rename tasks on A. Each change applies at once and survives a reload while the sync routes stay refused. Test: `changes made offline apply at once, survive a reload, and upload when the network returns`.
- **Reconnect.** Bring A back. B shows the new and renamed tasks. Same test.
- **Typing.** Open a synced task on A, take A offline, and type into Notes. Each keystroke shows at once and queues one write. On reconnect the upload folds them into one patch with the full text, and B shows the notes. Test: `typing notes shows each keystroke at once and uploads one write with the last value`.
- **Rejected.** Make A's next upload carry a write the schema refuses: the test rewrites a rename's write in flight to `priority: 99`. A shows "Couldn’t save a change to “<new title>”", the row goes back to the old title, and A's next new task reaches B. Test: `an edit the server rejects goes back to the server value with a notice, and the device keeps syncing`. A guest's refusal is in [Sharing](./sharing.md). Server half: `bun test server/src/upload.test.ts`; iOS: `swift test` (`VectorTests` for `rejectionNotice`).
- **Conflict.** Take both clients offline, rename the same task differently on each, and add notes on B. After A and then B reconnect, both show B's title, since its write reached the server last, and B's notes. Test: `both devices editing the same task offline converge, each field to the last write`.
- **Delete wins.** Take B offline and rename a task there. Delete the task on A. When B reconnects, its rename changes nothing and the task is gone on both. Test: `a delete beats an edit that reaches the server after it`.
- **Switch users.** Sign out on A and sign back in with the sync routes refused: A's tasks are there, from the local database. Sign out and create another account: the list is empty, and what it adds never reaches A's account. Sign in as A again: A's tasks come back from the server. Test: `signing out keeps this device’s data, and signing in as someone else starts from an empty list`.
- **Switch interrupted.** Make the browser refuse to empty the local images (the test patches `IDBObjectStore.prototype.clear`), sign out on A, and create another account. The app stays blank, tries the clear again, and `procrastimate-owner` keeps naming A's account, through a reload too. Once the clear works, the new account's empty list shows. Test: `this browser belongs to a new account only once the previous one’s rows are gone, and a refused clear is tried again`.
- **New device settings.** Choose ElevenLabs on A. Open a fresh profile B in another zone with the sync routes refused, and pin `Labels` in quick add's buttons. Once B's sync runs, both show ElevenLabs and `Labels`, and the settings name B's zone: B patched only what it changed and never wrote defaults. Test: `a new device holds its settings changes until the account’s settings arrive, then writes only those`.
- **Database won't open.** Add a task and reload in one moment while the page cannot start the database's workers. The app shows `Couldn’t open your tasks` with `Reload` instead of an empty list. Once the database opens, the task is there and reaches B. Test: `a database that cannot open says so, and an edit it could not write is written at the next launch`.
- **Big command.** Import a Todoist backup of 150 tasks offline, then reconnect: the project and its 150 tasks upload in one request. Test: `one command’s writes upload in one request, however many rows it changes`.
- **Reads only what changed.** With 150 tasks on both devices, rename one on A. A reads back at most 2 rows from its local database (its own write, then the server's copy of it) and B reads 1, where a reload used to read every row of every table. `window.procrastimate.reads()` counts them. Test: `an edit reads back only the row it changed, on this device and the other`.
- **Delete all.** On A, `Settings`, `Delete all data`, confirm. A's tasks are gone and stay gone after a reload. B's are gone at once. Both stay signed in. Test: `delete all data clears this device and the other`.
- **Unsynced.** Hold A's `/api/upload` and rename a task: its row gains the cloud only after about 3 seconds, and loses it once the upload is released. Take A offline and rename it again: the cloud shows at once, and its details show `Not saved yet. Will sync when online.` above the title. Back online, the cloud leaves. Same test. iOS: launch with `PROCRASTIMATE_OFFLINE=1` and `PROCRASTIMATE_DEMO=rows`; every seeded row shows the cloud (`Not synced yet`), and `Buy milk`'s details show the notice (`unsynced-notice`). Without the offline flag the DEBUG session's rows never sync and show no cloud.
- **Pull to refresh (iOS).** Drag any task list or Browse down past the top. A spinner shows under the bar and stays until the stream is idle; a change made on the web shows without it, about 0.1 s after the server takes it. Without a session (the DEBUG `PROCRASTIMATE_SIGNED_IN` launch) it ends at once.
- **iOS.** Each command hands its row writes to one serial writer into the PowerSync database, and every database change reads back only the rows it changed from the change log (`StoreTests`, `SpaceTests`, and the `rows` and `local-rows` vectors in `swift test`). `PROCRASTIMATE_OFFLINE=1` keeps sync disconnected for a launch: add a task, relaunch without it, and the task reaches the server. After a reinstall that kept the Keychain token, or `PROCRASTIMATE_RESET=1` with a session, the app opens signed in as the Keychain's owner with an empty database that sync fills: the user's own tasks land in Inbox (never under `Shared with me`), and what is added offline uploads as theirs.

## Gotchas

- Playwright's `context.route` never sees PowerSync's stream in Chromium, which runs it in a shared worker, so offline also uses `context.setOffline(true)`. A page cannot reload while the context is offline, so a reload test turns the network back on and keeps refusing the sync routes.
- `e2e/offline-shell.e2e.ts` allows the service worker, and runs only in Chromium: it empties the HTTP cache and slows the service worker's own requests through DevTools, since Playwright's routes never see them.
- Playwright contexts get `serviceWorkers: 'block'`: WebKit sends the page's requests through the push service worker, where `context.route` does not see them.
- The local database belongs to one account. Signing in as someone else clears it; signing out keeps it.
- The copy that saves an edit across a reload is per tab (`sessionStorage`), so closing the tab a moment after an edit can lose it.
- A change that shows only on the client that made it proves local state, not sync. `window.procrastimate.pending()` counts the writes not on the server yet. `window.procrastimate.reads()` counts the reloads, the rows they read, and their milliseconds.
