# Performance audit, November 2026

This audit times every screen, input, and action of the web app, reads the iOS app and the server for the same paths, and follows each path down to the Worker and the `App` Durable Object. For each one it asks what would have to change for the action to be seamless. It records what was measured, what this audit changed, and what is left, with the evidence for each.

## How it was measured

- **Data.** Production on November 5, 2026 held 399 tasks (69 open, 330 completed), 6 projects, 4 sections, 1 label, 31 tasks with attachments, and 73 KB of notes. `app-web/perf/audit.perf.ts` seeds an account of that shape, and `PERF_SCALE=10` seeds ten times the tasks.
- **Harness.** The spec drives the production build served by `wrangler dev` (`E2E_WORKER=1`), so the `App` object runs on its own SQLite as it does in production. Chromium runs at 4x CPU throttling, about a phone. Each action reports its longest input-to-paint (INP as Event Timing measures it, in 8 ms steps), main-thread time beyond 50 ms in long animation frames ("blocked"), the rows the store read back, and the API calls it made. [Testing](decisions/testing.md) says how to run it.
- **Comparison.** Before and after builds ran interleaved, two rounds each, because other agents' builds swing this Mac's load average between 10 and 110 within minutes. One run made while an iOS build compiled beside it tripled every number, including untouched paths, and was discarded. Counts (API calls, rows) do not depend on load; timings within about 20 ms are noise.
- **Production.** From the DFW edge, on a reused connection, a static file answers in about 25 ms and `GET /api/status`, which goes through the Worker to the object, in about 80 ms. The agent API's `GET /api/view` takes 120 to 200 ms.

## Every screen and action at production scale

Two interleaved rounds, after the changes below, at 4x throttling. Blocked is 0 unless noted.

| Action                                                       | Input to paint                 | Notes                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Boot to the first row                                        | 390 ms                         | 7 API calls after the first frame: `sync/token`, `push/key`, `me`, `people`, two `sync`, one `favicon`. None blocks the first frame. |
| Open Inbox, No date, Tomorrow, This week, a project, a label | 16 to 48 ms                    |                                                                                                                                      |
| Open Completed, first time                                   | 16 to 24 ms                    | 130 to 185 ms blocked after the paint while its route chunk loads.                                                                   |
| Open task details                                            | 56 ms                          | Was 120 to 136 ms with 57 to 69 ms blocked.                                                                                          |
| Type in the details title                                    | 56 to 72 ms a key              | Saves on Enter or blur.                                                                                                              |
| Type in notes                                                | 64 to 72 ms a key              | Was 14 syncs for 20 characters, now none while typing.                                                                               |
| Set priority, close details                                  | 40 to 64 ms                    |                                                                                                                                      |
| Open quick add, type a title, a date, `#`, `@`               | 40 to 72 ms a key              |                                                                                                                                      |
| Save quick add                                               | 64 to 72 ms                    | 2 API calls.                                                                                                                         |
| Complete, undo                                               | 32 to 48 ms                    | 2 API calls each.                                                                                                                    |
| Open search, type                                            | 24 ms, then 88 to 112 ms a key | About 30 ms of each key is the results' `flip` and fade animations.                                                                  |
| Settings, switch theme                                       | 40 to 56 ms                    |                                                                                                                                      |
| An edit from another device reaching the row                 | 37 to 48 ms                    | From the sync request to the row on screen, locally.                                                                                 |

## What this audit changed

- **Notes save when typing pauses, on web and iOS.** Every keystroke in Notes ran a whole store command. On the web that is a local write and read back, a copy into `sessionStorage`, and a `POST /api/sync` within 100 ms. On the server it is a write, an `_log` row, a `log` row with five indexes, and a head published to every socket, so every other open device pulled. On iOS it was a store commit with an O(N) diff and index rebuild on the main thread, a widget timeline reload, and the same sync. Both clients now keep typed notes in the field and save 400 ms after the last key, and at once on blur, on close, and when the page or app goes to the background. Measured on the web: 20 characters made 14 syncs and 20 reads before, and 0 syncs while typing after. At 10x data the store reads went from 20 taking 207 ms to 1 taking 15 ms. An end-to-end step proves a reload right after typing keeps the text, and fails with the page-hide save removed. Two throwaway XCUITests prove the iOS note survives a relaunch after a pause and after going to the Home Screen.
- **A blank field no longer runs the quick add parser.** Opening any task's details parsed its empty `Add subtask` field, and in Chromium that parse spent about 55 ms of a 4x-throttled frame in the parser's rule loop. The parser now skips its rules and masks for blank text, whose result was the same. Opening details went from 120 to 136 ms to 56 ms, and from 57 to 69 ms blocked to 0. The reason a blank parse cost that much in the page, when Node parses it in 0.1 ms once warm, was not found.
- **The parser warms up in idle time.** Its `reminder`, `due`, and weekday-list patterns are 12 KB, 12 KB, and 7 KB. V8 compiles each on its first run and again, to native code, on its second: under Node the first two parses took 65 ms and 34 ms on this Mac, and later ones 0.1 ms. JavaScriptCore compiles once (8.5 ms). The layout runs two parses in separate idle callbacks once the store has loaded. Without them the first quick add keystrokes hit a 27 to 73 ms long frame in the input handler. With them there was none, in two runs each.
- **Rows render only the first line of notes.** A row shows one truncated line, but rendered the whole note through `LinkedText`, each link with its icon and favicon request. A 2,600-character note made a row of 130 accessibility nodes. Rows now pass the first non-blank line, cut at 280 characters.
- **The desktop sidebar is not mounted on a phone.** CSS hid it below 768 px, but it stayed mounted and rebuilt the list catalog, with its counts over every task, on every command.
- **An index covers the agent API's view.** `clientsOf` groups the space's task log by id, and no index matched, so it walked every space's task log through `log_entity`. `log_user_task(user_id, kind, id, seq)` covers it: 31 ms against 7.8 ms over 60,000 log rows in `bun:sqlite`.

## Checked and left alone

- **Migrations on every object start.** `openStore` reruns the engine's and the server's migration on each wake. On a warm database it takes a median 0.26 ms, so a schema hash to skip it would not earn its place.
- **Search animations.** Each keystroke animates the results with `flip` and a fade, and `flip` measures every row twice, about 30 ms of a throttled key. The motion is a design choice, and the key still paints in about 100 ms.
- **Sentry at full sampling.** [Observability](decisions/observability.md) measured it at about 10 ms a sync and chose to keep every trace.

## What is still open, by layer

Each item names what limits the action today and what would make it seamless. None of these is visible at today's scale unless it says so.

### Web client

- **Long lists render every row.** At 10x data, opening a project or the Inbox blocks 145 to 205 ms after the paint, and a theme switch blocks 143 ms recomputing styles. Both grow with rows on screen, not with interaction. Rendering the first screenful and the rest in idle frames, or windowing the list, would remove it. At today's 69 open tasks no list blocks.
- **Every command rebuilds whole lists.** A command replaces `store.own`, so the sidebar's catalog, the open list's day grouping, and the filter options rerun over every task, and `animate:flip` measures every row of a list whose array changed. A completed or edited task costs O(tasks) work per command. Memoizing the lists on the fields they read and keeping an unchanged list's array would make an edit cost O(changed rows).
- **The store reads back its own writes.** After each command the worker writes, logs the change, and the store reads the changed rows back and rebuilds the space with `resolveDangling` and a sort. At today's scale this is 10 to 15 ms of worker time and nothing on screen. Skipping the read when the log names only rows this tab just wrote with the same values would remove it.
- **Launch makes 7 API calls.** `/api/me` duplicates the user `/api/sync/token` already returns, `/api/people` could ride along, and `/api/push/key` could be cached with the subscription. Each is a request to the one object, off the first frame.
- **Bundles.** The main chunk is 529 KB (150 KB gzipped) and the layout 353 KB (105 KB gzipped), because the layout imports quick add, Ramble, search, settings, sharing, details, and the image viewer up front. `sqlite3.wasm` is 879 KB (408 KB gzipped). The service worker caches them, so only the first visit after a deploy pays for them.

### iOS

Read from the code, not measured; the `PerfDemo` harness in [iOS app](decisions/ios.md) is how to measure them.

- **Store observation is too coarse.** One `snapshot` and one `index` back every view, so any commit or sync redraws every visible row in every tab, hidden tabs included. Per-task observation, or rows built from plain values and made `Equatable`, would limit a change to the rows it touched.
- **Commits rebuild everything on the main thread.** Each commit sorts all tasks, diffs every task and comment into row writes, rebuilds the index, and, once the database reports back, rebuilds the space in `LocalRows` and compares the whole snapshot again.
- **Launch and activation.** The first read and decode, the engine's `migrate`, and a 60-day EventKit query run on the main actor, and `SessionToken.read()` goes to the Keychain on every call.
- **Search and quick add.** Search scans every task in `body`, with an O(results²) index lookup, on every keystroke and every store change. Quick add rebuilds every space's projects and labels three times per body pass.
- **Images.** Attachments read and decode on the main actor into an unbounded dictionary of full-size images, and one image arriving redraws every thumbnail.

### Server and infrastructure

- **Where the object lives.** Every `/api/*` request is the browser, the nearest Worker, then the one `App` object. From DFW the object adds about 55 ms over the edge on a warm connection. Its location was never pinned: it was created where its first request came from. Logging the object's colo would say whether it is near the user. Moving it is a new object made with a `locationHint` and restored from the R2 backup, a production data move that is Stefan's call.
- **The minute cron wakes the object 1,440 times a day.** Each tick runs `deliverDue` and the webhook scan, with a Sentry transaction and check-ins, even when nothing is due. An object alarm set to the next push time, and re-armed by `replan` and by a write to a space with a webhook, would wake it only when there is work. A tick also queues behind, or ahead of, a user's sync on the single-threaded object.
- **Writes do more storage work than the edit.** One counted write updates the row, `_changes`, `_log`, `_meta`, and a `log` row with five indexes, two of them JSON expressions. When it moves a push field, `replan` reads every open task. On the free plan's 100,000 rows written a day, the notes fix above removed the largest source: a log row per keystroke.
- **Every socket hears every head.** A write publishes the new head to every user's devices, and each pulls, finding nothing new when the write was someone else's. With one user this is correct. With many, publishing to the sockets of the spaces that changed would keep it O(readers).
- **Sync bodies are parsed four times.** `api.ts` parses and re-serializes the body to set the client, the engine parses it again, and the response is cloned and parsed to read `rejected`. Calling the space directly would parse once.
- **Link titles, favicons, and GitHub states fetch from the object.** Each device asks again, since responses are private. Caching them in the Worker with `caches.default`, keyed by URL, would answer most of them at the edge.
- **Image bytes live in the object's SQLite and in every backup.** Each image request goes through the Worker to the object, and the daily backup holds every image as base64 in one string in the object's memory. Moving the bytes to R2 behind signed URLs would let the Worker serve them from cache, and keep the dump small.
