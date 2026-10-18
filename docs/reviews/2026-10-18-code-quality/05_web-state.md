# Web client state, sync, and non-component modules review

Scope (lines): `app-web/src/lib/store.svelte.ts` 679, `powersync.svelte.ts` 197, `database.ts` 125, `api.ts` 74, `session.svelte.ts` 154, `reorder.svelte.ts` 256, `optimistic.svelte.ts` 80, `push.svelte.ts` 227, `ui.svelte.ts` 151, `completed.svelte.ts` 59, `row-menu.svelte.ts` 110, `comments.svelte.ts` 14, `theme.svelte.ts` 45, `images/encode.ts` 58, `images/images.svelte.ts` 126, `images/local.ts` 92, `ramble/capture.ts` 274, `ramble/entries.ts` 52, `ramble/transcript.ts` 7, `ramble/wave.ts` 23, `dictation.ts` 152, `device.ts` 107, `spaces.ts` 50, `lookup.ts` 56, `names.ts` 51, `completion.ts` 60, `caret.ts` 88, `screen.ts` 40, `show-added.ts` 30, `sentry.ts` 57, `sentry-dev-frames.ts` 75, `todoist-import.ts` 9, `priorities.ts` 9, `reminders.ts` 23, `label-colors.ts` 7, `label-icon.ts` 5, `copy.ts` 15, `subtask-draft.ts` 13, `quick-add-buttons.ts` 24, `service-worker/index.ts` 50, `hooks.client.ts` 5, `app.d.ts` 11, `vite.config.ts` 62, `package.json` 35. Total 3,837.
Commit: ad9437e
Method: Read every file in the slice in full, plus `docs/decisions/sync.md`, `push-notifications.md`, `auth.md` (session parts), `app-web/AGENTS.md`, and the callees in `shared/` (`local-rows.ts`, `rows.ts`, `comments.ts`, `subtasks.ts`, `store.ts` ordering helpers, `snapshot.ts`), `server/src/push.ts` (subscribe semantics), `routes/+layout.svelte` (sync and push lifecycle), `TaskRow.svelte` and `CompletedRow.svelte` (lookup consumers), and `e2e/sync.e2e.ts` test names. Ran `bun test app-web/src/lib` (15 pass). Wrote two scratch probes under `/tmp/thermo05/`: one compiles a `.svelte.js` module with the repo's Svelte 5.57.2 and counts how often a `$derived` reruns (F6), one times `LocalRows.own()` plus `keepSame` on 1,000 and 3,000 tasks (smaller notes). Traced `git log -S` for the 503 rule (F3). I did not run svelte-check or tsc. Neither would have tested any claim here.

## Verdict

This slice is in good shape. The store, the change-log read path, and the account-switch clearing are carefully built, the docs describe them well, and e2e specs pin the important races. In-memory cost per read is small: about 0.4 ms on 1,000 tasks. The problems sit at the edges. A local write the database refuses leaves memory showing it indefinitely, because the code that should read the database back never runs. Push subscriptions are never handed off on sign-out or an in-tab account switch, so the previous account's reminders keep arriving. Any 503 from `get-session` signs the user out. The mic stream leaks when audio setup fails after permission was granted. On the simplification side, `startVoiceInput` is dead production code, and its unit test pins the opposite of what production does.

## Findings (most important first)

### F1. A local write the database refuses is never read back, so memory keeps showing it [bug] [CONFIRMED by trace] [effort: S]

`store.svelte.ts:215-237` (`#write`). When `writeRows` rejects, the error handler sets `this.#cursor = null`, and the comment there says the next read will "take all of it back". That read is only started from the `.finally` when `this.#stale` is already true. A refused transaction commits nothing, so no trigger writes to `procrastimate_changes`, `powerSync.onChange` never fires, and `#stale` stays false. Nothing calls `#reload()`. Memory keeps the command the database refused until some unrelated change arrives (a sync from another device, or the next command's write). In that window the user sees an edit that does not exist locally and will never upload. `docs/decisions/sync.md` ("the read after a write the database refused take every table whole") assumes that read happens soon. Nothing triggers it, and no spec pins it: the "database that cannot open" e2e covers a failed open, not a failed write.

There is a second, smaller problem. The refused entry stays in `#unwritten` and is saved to `sessionStorage` again on every later command. A reload replays it before the first read. A deterministic refusal (a constraint, a malformed value) is retried and reported to Sentry on every launch of that tab, for the tab's lifetime.

Remedy: set the stale flag in the error handler, so the `.finally` runs a full read:

```ts
error => {
	reportError(error);
	this.#cursor = null;
	this.#stale = true;
},
```

To stop the replay loop, drop the entry from `#unwritten` when the refusal is a SQLite constraint or type error. A worker or quota failure should keep it, which is the intent of "a write that fails keeps its copy". Behavior otherwise stays the same.

### F2. Push subscriptions survive sign-out and are not re-registered for the next account in the same tab [bug] [CONFIRMED by trace] [effort: S]

`push.svelte.ts:151-160` caches `#registered = subscription.endpoint` on the module-level `push` singleton and returns early whenever the endpoint matches. `session.signOut()` and `session.clear()` (`session.svelte.ts:77-123`) never call `api.push.unsubscribe`, and nothing anywhere in `app-web/src` does (grep: the only `unsubscribe(` calls are the browser `PushSubscription.unsubscribe` in the rekey path). The server keys rows by `(user_id, device_id)` (`server/src/push.ts:132-151`). So:

1. A user signs out. Their row stays, so their reminders keep arriving on this browser as system notifications with task titles, under the sign-in screen.
2. They sign in as B in the same tab. `adopt` → layout effect → `push.start()` → `detect()` → `#register(info)` sees `#registered === endpoint` and returns without calling the server. B gets no push on this browser until a reload. A's notifications keep coming until the push service answers 404 or 410 for that endpoint, which it won't, because the endpoint is live.

Remedy: in `signOut`, call `api.push.unsubscribe()` (best effort, before the cookie is dropped). Reset `push.#registered = null` when the stop function returned by `push.start()` runs. The layout already calls it when the user changes. Both are a few lines, and the existing single-user flows are unaffected.

### F3. A 503 from `get-session` signs the user out [robustness] [PLAUSIBLE] [effort: S]

`session.svelte.ts:50`: `if (response.status === 401 || response.status === 503) this.clear()`. `git log -S` shows this arrived with Better Auth (#55, `a6f6456`), when the server answered `503 'Sign-in is not configured'` with no auth configured. The server now fails fast on missing config (`f7de549`), and nothing on the auth path returns 503 any more (grep `server/src`: only Ramble does). A 503 today means a Cloudflare, Hyperdrive, or Supabase outage. Then the app clears `procrastimate-user` and shows sign-in. That is exactly the case `auth.md` says should keep the session ("A network failure keeps it. A `401`, or a session response with no user, clears it"). The data survives, but the user is pushed to sign in during an outage when they could have kept working offline.

Remedy: drop `|| response.status === 503`. The `!response.ok` branch below already keeps a cached session. Cross-slice: `app-ios/Sources/App/Sync/Session.swift:58` has the same rule and needs the same change.

### F4. Ramble's socket path leaks the microphone stream when audio setup fails after permission [bug] [CONFIRMED by trace] [effort: S]

`ramble/capture.ts:192-212` (`startMic`) gets the stream first, then runs `new AudioContext()` and `audio.audioWorklet.addModule(blobUrl)`. Either can throw: Safari caps concurrent AudioContexts, a future CSP without `blob:` would break `addModule`, and the worklet can fail to load. When one throws, `stream` is a local of the rejected `startMic`. Its tracks are never stopped and `audio` is never closed. The caller's rejection handler (`:177`) calls `finish('denied', 'The microphone is off…')`, which stops `stream`, but that outer variable is still null, so it stops nothing. Result: the browser's recording indicator stays on with no Ramble open, and the message wrongly blames permission. `meter()` (`:242-274`) has the same shape: an `AudioContext` that throws after `getUserMedia` resolved leaves `close` as a no-op and the stream live.

Remedy: inside `startMic`, wrap everything after `getUserMedia` in `try { … } catch (e) { stream.getTracks().forEach(t => t.stop()); void audio?.close(); throw e; }`. Split the caller's rejection so only a `NotAllowedError` or `NotFoundError` from `getUserMedia` maps to `'denied'` and everything else to `'error'` or `'unavailable'`. Do the same in `meter`.

### F5. The dictation module's public entry point is dead, and its tests pin the opposite of production behavior [simplification] [CONFIRMED] [effort: S]

`dictation.ts:120-152` (`VoiceInput`, `startVoiceInput`) has no caller outside `dictation.test.ts`. Ramble goes through `listenRamble` in `ramble/capture.ts`, which uses `NativeDictation` directly. The `parseRamble` import exists only for it. The test "a network error stays on native and keeps the transcript" (`dictation.test.ts:114`) asserts that a native error does not open ElevenLabs. Production does the opposite on purpose: `speechThenSocket` (`capture.ts:65-80`) moves to the socket when native fails before hearing anything, which handles the Brave and Chromium network-error case. So the only unit test on voice capture covers dead code, and the real fallback rule has no unit test.

Remedy: delete `startVoiceInput`, `VoiceInput`, and the `parseRamble` import (about 35 lines). Point the tests at `NativeDictation` (fake `SpeechSession`, fast-end counting, fatal mapping) and at `speechThenSocket`'s fallback rule. Also drop the identity mapping `reason === 'stopped' ? 'stopped' : reason` in `capture.ts:95`. `DictationEnd` is already a subset of `CaptureStop`. Behavior is unchanged.

### F6. The store's derived graph depends on the whole snapshot, so per-list consumers rerun on every command [efficiency] [CONFIRMED mechanism, PLAUSIBLE magnitude] [effort: S]

`store.svelte.ts:101-108`. `#view = $derived(merged(this.own, this.spaces))`, and the getters `tasks`, `labels`, `sections`, and `comments` read `this.#view.<list>`. `#apply` always assigns a new `own` object, even when the rule replaced only `tasks`. Svelte tracks the `#view` signal, not its fields, so every derived that reads any one list reruns on every command. The same goes for `#ownProjects = projectsInOrder(this.own.projects)`, which also re-sorts with `toSorted` and so yields a new array each time, which makes `#projects` new too. I confirmed the mechanism with the repo's Svelte: a `$derived` reading `view.comments` reran 6 times over 5 task-only updates, and putting one intermediate `$derived(this.#view.comments)` in between cut it to 1 (`/tmp/thermo05/probe.svelte.js`).

Consequences on a task title edit or a completion: `comments.svelte.ts`'s `#badges` rebuilds every badge object, so every `TaskRow`'s `commentBadge` derived gets a new object and its badge block reruns. Every row's `lookup.project`, `lookup.section`, and `lookup.labelsOf` reruns its `find`, `#children` regroups and re-sorts all subtasks, and the sidebar's project list re-diffs. Each piece is cheap. Multiplied by every mounted row (hundreds) on every keystroke-driven command (notes typing writes per keystroke, per the "typing notes shows each keystroke" spec), it is the main avoidable per-command cost on the "extremely snappy" bar.

Remedy: one stable derived per list, and projects sorted only when `own.projects` changes:

```ts
#tasks = $derived(this.#view.tasks);
#labels = $derived(this.#view.labels);
#sections = $derived(this.#view.sections);
#comments = $derived(this.#view.comments);
#ownProjectList = $derived(this.own.projects);
#ownProjects = $derived(rules.projectsInOrder(this.#ownProjectList));
```

The getters return these instead. Values and order are identical, and only the propagation stops. The same pattern would let `task(id)`, `project(id)`, and `label(id)` use a `$derived(new Map(...))` instead of `find`. `TaskRow`'s `lookup.task(parentId)` is currently O(n) per subtask row per command.

### F7. Reorder commits an index computed against a list that sync may have changed mid-drag [bug] [PLAUSIBLE] [effort: S]

`reorder.svelte.ts`. `Drag.from`, `Drag.to`, and `mids` are measured at lift (`#lift`, `:113-140`), and `#drop` calls `move(id, ended.to)` (`:213`), where `to` indexes the list as it was at lift. The store applies sync reads while the drag is live. If another device adds, removes, or reorders a sibling during the drag, the index lands in a different list. Example: projects `[A, B, C, D]`, drag D to index 1 (between A and B). Meanwhile a sync inserts X first, giving `[X, A, B, C, D]`, and `moveProject(D, 1)` produces `[X, D, A, B, C]`: D ends up above A, not between A and B. The live `offset(index, id)` shift also misaligns, because render indices no longer match `from`. It is rare for one user on two devices, but it is exactly the "concurrent sync update" case.

Remedy: record the neighbor ids at drop time (`before = mids order[to-1]`, `after = …`) and have callers move relative to an id. Or simply cancel the drag (`#drop(false)`) when `count()` differs from `mids.length` at drop. The second is three lines and keeps behavior identical in the common case.

### F8. No offline app shell: a cold launch without network cannot open the app [robustness / product question] [PLAUSIBLE] [effort: M]

`service-worker/index.ts` handles only `install`, `activate`, `push`, and `notificationclick`. It has no `fetch` handler and no precache. `static/_headers` marks `/_app/immutable/*` as immutable, but `index.html` gets Cloudflare's default revalidating cache, so a reload or a home-screen launch while offline fails at the HTML. `auth.md` says the user id is cached "because … the app must open offline", and `sync.md` says each client "works fully offline". Both hold only for a tab that is already open. `$app/service-worker` already exports `build`, `files`, and `version`, so a cache-first shell is about 25 lines: precache `build` plus `files` on install, drop old caches on activate, and serve navigations from cached `/index.html` when the network fails. It is labeled a product question because it adds behavior, and the SW update model (stale shell until the next launch) needs a decision.

### F9. `writeRows` costs one SELECT per put to decide insert or update [efficiency] [PLAUSIBLE] [effort: S]

`database.ts:111-125`. For every `put` it runs `select id … where id = ?` before the insert or update, and each statement is a round trip to the SQLite worker. Edits are `patch` writes, so this only bites on creates: one Todoist import or undo-delete of N rows pays N extra round trips inside the one transaction, which holds the write lock and delays the next read. Remedy: per kind, read the existing ids once with `inArray(table.id, putIds)` (chunked under the 500-variable cap `WHOLE_TABLE_ABOVE` already respects), then branch on a `Set`. It keeps the same "views refuse an upsert" handling and gives identical results.

### F10. Push: an unreachable permission branch, and a key fetch on every focus while push is off [simplification] [CONFIRMED] [effort: S]

`push.svelte.ts:82-86`. By that line `Notification.permission` is neither `'denied'` (returned at `:70`) nor `'default'` (returned at `:71-74`), so `permission !== 'granted'` cannot be true. Delete the branch along with its `REKEY_KEY` removal and `unsubscribe`. Separately, `#retry` (`:162-166`) reruns the whole `detect()` on every `visibilitychange` to visible while the state is `'off'`. That is the steady state for a user who dismissed the prompt, so every tab focus fetches `GET /api/push/key` for nothing. Only `'unavailable'` and `'error'` can change on their own. `'off'` changes only through `request()` or the first-gesture prompt. Limiting retry to those two states removes the requests with no visible change.

## Smaller notes

- **In-memory read cost is fine.** `LocalRows.own()` plus `keepSame` after a one-row change takes 0.36 ms on 1,000 tasks and 0.84 ms on 3,000 (`/tmp/thermo05/bench.test.ts`). Rebuilding the own snapshot whole on each read is not worth optimizing. F6 is the cost that matters.
- **No `pushsubscriptionchange` handler.** When the browser rotates or expires a subscription with the app closed, the server gets 404 or 410 and drops the install. `#detect` resubscribes only on the next launch, so notifications are lost in between. A handler that resubscribes with `event.oldSubscription.options.applicationServerKey` and PUTs it would need the install id in the SW (IndexedDB), so it is noted, not filed.
- **`#register` swallows non-401 failures silently** (`push.svelte.ts:157-159`). A 500 leaves the state `'on'` with nothing registered, unreported. Add `reportError`.
- **`OptimisticList.load`** (`optimistic.svelte.ts:35-37`) keeps a saved row whose key starts with `pending-` whenever the server list lacks it. That covers a list read before the add committed, but also an item deleted elsewhere since, which then lingers until the sheet remounts. It is low impact, since the share sheet and AI accounts are short-lived.
- **`clearUntilDone`** (`store.svelte.ts:49-59`) retries forever with backoff, which the docs intend. Each failed try is reported, so a persistent failure sends a Sentry event every 30 s for as long as the tab stays open. Consider reporting once per streak.
- **`images.svelte.ts` `#urls`** creates object URLs and never revokes them. Memory grows with the images viewed in a session. It is bounded, so not filed.
- **Duplicated constants.** `ramble/capture.ts`'s worklet string hard-codes `16000` and `1600`, which are `RAMBLE_SAMPLE_RATE` and `RAMBLE_FRAME_BYTES / 2` from `shared/ramble/protocol.ts`. Interpolate them so a protocol change cannot desync. The SW's `parse` hand-validates `PushMessage`, and `shared/push.ts` has a type but no schema. A `pushMessageSchema` there would let the server and SW share one definition.
- **`lookup.ts` `provideReadOnlyLookup`** reimplements the store's lookups with `find` per call, and `children()` regroups all tasks on every `subtasks(id)` call, which is O(n) per row on a public link page. Wrap `children` in a `$derived.by` or a memo.
- **Inconsistent device keys.** `completed.svelte.ts` uses `procrastimate.completedRange` and `procrastimate.showCompleted` (dots). Every other key uses `procrastimate-` and lives in `device.ts`, whose list `sync.md` cites as the complete set of device-local keys. Move them into `device.ts`, or list them in the doc.
- **`api.ts` `browser()`** parses the UA on every request, twice for push routes. It is a nested ternary chain that a `[regex, name][]` table plus `find` would replace. Computing it once at module load is safe, since the UA does not change. Keep `timeZone` per call.
- **`Clock`**'s comment says "minute-resolution", but it ticks every 15 s. `fireDueReminders` then scans every own task's notification times on each tick, which is O(n) every 15 s. Cheap at 1,000 tasks.

## Test coverage observations

- Unit tests in the slice cover only `spaces.ts`, `dictation.ts` (mostly dead code, see F5), `ramble/transcript.ts`, `ramble/wave.ts`, and theme contrast. `NativeDictation`'s restart, fast-end, and fatal logic and `speechThenSocket`'s fallback have no direct test.
- The store's concurrency rules (a read discarded when a command ran during it, `#stale` replay after writes, held settings) are pinned only end to end in `e2e/sync.e2e.ts`. Nothing covers a single refused local write (F1), and the e2e for a failed open does not exercise it.
- Nothing tests account switching for push, or sign-out unsubscribing (F2), and no e2e touches `push.svelte.ts` beyond what layout and fixtures stub.
- `reorder.svelte.ts` has no test of a list that changes mid-drag (F7). `optimistic.svelte.ts` is covered by `e2e/optimistic.e2e.ts` for the add, remove, and refusal paths.
- `capture.ts` failure paths (mic denied, AudioContext failure, socket closed before mic) have no test. The Ramble e2e runs the cassette happy path.
