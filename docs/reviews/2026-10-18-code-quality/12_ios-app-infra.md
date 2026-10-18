# iOS app infrastructure review (slice 12)

Scope (all read in full): `app-ios/Sources/App/`

- Sync: APIClient 62, AppClient 35, LocalDatabase 183, OptimisticList 113, Session 153, SessionToken 64, SharedSession 36, SyncClient 369, SyncConnector 91, SyncedRow 117
- Intents: DataIntents 17, Entities 138, IntentEffects 290, IntentHarness 200, IntentRouter 46, IntentSession 35, NavigationIntents 94, Shortcuts 100, SpotlightIndex 48, TaskIntents 149
- Calendar/CalendarSync 137, Places/PlaceMonitor 295, Notifications/LocalNotifications 281, Images/ImageEncoder 57, Images/TaskImages 170, Import/TodoistImport 47, Import/ZipReader 100, Launch/Launch 39, Data/StoreLocation 20, Errors/ErrorReport 64, Support (LabelColorModel 51, LinkedText 48, OnMessage 28, Telemetry 132), Theme (SRGB 29, Semantic 91, ThemeSettings 83), Toasts 71, Dictation/SpeechDictation 155, Navigation (Navigator 147, Pin 82, RootView 391, Route 30, Sheet 20, SwipeBack 14), Debug (PlacesDemo 185, SectionsDemo 23, SharingDemo 66), Environment 34, ProcrastimateApp 162
- `Sources/Widgets/PlaceActivityWidget.swift` 98, `Sources/Activity/PlaceActivityAttributes.swift` 12, `Package.swift`, `Config/*`, `scripts/{test,generate}` (archive/run/parity scripts skimmed)

Commit: ad9437e
Method: read every file above plus `app-ios/AGENTS.md`, `docs/decisions/{ios,sync,sync-auth,auth}.md`; traced callees into `Sources/Core` (`Store.reload/written/saved/commit`, `Rows.coalesce`, `Notifications.scheduleChange/isTaskTag`) and the web counterpart `app-web/src/lib/powersync.svelte.ts` for upload ordering. No simulator. `swift build` was skipped on purpose: `Package.swift` builds only `Core`, which is not this slice, so it would prove nothing about these files. The confidence labels come from tracing code paths, not from running them.

## Verdict

This slice is in decent shape. The PowerSync lifecycle (one serial writer, coalesced reads, the user switch that clears first) is careful and matches its docs, and Swift 6 isolation is handled without `DispatchQueue` or data races. Two things matter most. First, `Session.refresh` signs Stefan out on any non-200 answer from `get-session`, including 5xx and a captive portal's HTML. `auth.md` says a network failure keeps the session. Second, the iOS connector drains the image queue _before_ it reads the PowerSync batch, which is the reverse of the web's documented order. An edit can then upload before its image bytes. The rest is duplication in the notification scheduler, a full Spotlight rebuild on every change, and a few swallowed failures.

## Findings (most important first)

### F1. A server hiccup or captive portal signs the user out [bug] [CONFIRMED] [effort: S]

`Session.refresh` (`Sync/Session.swift:57-70`) clears the Keychain token for a `401` **or a `503`** (line 58). It also clears it through the `guard` at 63-70 for _any_ other status that is not 200 (500, 502 from Cloudflare, 429), and for any 200 whose body is not JSON with `user.id` (a hotel or airport captive portal answers 200 with HTML). Trace: launch, `.task { await auth.start() }` (`ProcrastimateApp.swift:98`), then `refresh()`, then a 502, which fails the guard. `SessionToken.clear()` deletes the token, the shared Notouroboros item, and the stored user id, and `signedIn = false` shows `SignInView`. `docs/decisions/auth.md:6` says: "A network failure keeps it. A `401`, or a session response with no user, clears it". Only the last two should sign out. Remedy: clear only on `401`, or on a 200 JSON body whose `user` is null. Return without changes for anything else, as the `catch` at 54-56 already does:

```swift
if http.statusCode == 401 { endSession(); return }
guard http.statusCode == 200, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
guard let user = object["user"] as? [String: Any], let id = user["id"] as? String else { endSession(); return }
```

Behavior for real rejections is unchanged. The 503 branch dates from the first Better Auth commit (a6f6456), and no server route answers 503 for auth, so nothing depends on it.

### F2. An edit can upload before its image, because iOS drains images before reading the batch [bug] [CONFIRMED order, PLAUSIBLE impact] [effort: S]

`SyncConnector.uploadData` (`Sync/SyncConnector.swift:33-36`) calls `TaskImages.uploadQueued` first and calls `getCrudBatch` after it. `uploadQueued` lists the queue folder once, at its start (`TaskImages.swift:98`, `Files.queued()`), and then does one PUT per file, each up to 1.5 MB. Picking two photos in a row goes like this. Photo 1's commit triggers pass P1. P1 lists the queue (photo 1 only) and spends seconds on its PUTs. Meanwhile `attach` (`TaskImages.swift:61-76`) encodes photo 2, writes its files, and commits `images: [1, 2]`. P1 then reads the batch, which now holds photo 2's edit, and posts it. The server and other devices get an `ImageRef` with no bytes behind it. They see a missing image and retry every 30 s (`retryMissing`) until a later upload pass sends the file. The web connector does the opposite on purpose (`app-web/src/lib/powersync.svelte.ts:65-72`): "an entry exists only after its image was queued, so draining the image queue after reading the batch covers it." Remedy: swap the two lines so `getCrudBatch` runs first, then `uploadQueued`, then the post, and correct the matching sentence in `docs/decisions/ios.md` (Sync, "The connector"). Every image named by the batch was written to the queue before its commit, so the guarantee holds by construction.

### F3. Two copies of the notification schedule pass, and nothing serializes them [robustness + simplification] [PLAUSIBLE] [effort: S]

`LocalNotifications.applySchedule` (static, `Notifications/LocalNotifications.swift:108-130`) and `sync()` (157-182) are the same algorithm written twice: compute `upcomingNotifications`, read pending requests, `scheduleChange`, remove, add, then submit a BG refresh. `scheduleRefresh` (206-211) duplicates 126-129 again, and `request(_:now:)` (186-188) is a one-caller wrapper. Nothing serializes either path, and each awaits `pendingNotificationRequests()` and up to 60 `center.add` calls. Within one second the following can all run: `detect()` (launch, foreground, BG refresh), `tasksChanged` (250 ms debounce), `significantTimeChange`, and an intent's `followUp`. `followUp` (`Intents/IntentEffects.swift:276-284`) runs **both** `applySchedule` and `tasksChanged`, and the root `.onChange(of: store.tasks)` adds a third pass. Interleaving: pass A computes its schedule including new task T and starts adding. The user completes T. Pass B reads the pending list before A's add of T lands, so it has nothing to remove. A then adds T, and a notification fires for a completed task. Remedy: one `schedule(status:)` body behind a chain like `PlaceMonitor.sync()` (`running` task, `PlaceMonitor.swift:110-118`). `sync()` and `applySchedule` both call it, and `followUp` with a session awaits `session.notifications.sync()` only. That removes about 30 lines and the race. Behavior is unchanged because the diff is idempotent: re-adding an identifier replaces it.

### F4. Spotlight rebuilds the entire index, eagerly and with a project sort per task, on every change [efficiency] [CONFIRMED] [effort: S]

`SpotlightIndex.schedule` (`Intents/SpotlightIndex.swift:15-23`) builds every `TaskEntity` _before_ the 300 ms debounce. A burst therefore builds the full list once per change, and all but the last are thrown away. `listed` (41-47) passes `store.projects` inside the per-task closure. `Store.projects` is computed as `StoreRules.projectsInOrder(snapshot.projects)` (`Core/Store.swift:137`), so it re-sorts all projects once per open task: with 1,000 open tasks and 50 projects, that is 1,000 sorts on the main actor per change. Three `onChange`s (tasks, projects, labels, `ProcrastimateApp.swift:110-112`) plus `withStore` each call it. `replaceAll` then deletes every entity and re-indexes all of them through CoreSpotlight IPC. Remedy: build the entities inside the debounced task, hoist `let projects = store.snapshot.projects` (order is irrelevant to `make`), and keep a cache of the last indexed `TaskEntity` values by id. Then send `replace(changed, removing: gone)`, which `SpotlightIndex.replace` already supports for `reindexEntities`. The index contents stay identical.

### F5. A failed local write disappears silently [robustness] [CONFIRMED] [effort: S]

In `SyncClient.run` (`Sync/SyncClient.swift:91-100`), when `database.write(batch)` throws (disk full, or a value that fails `SyncedRow` encoding, which aborts the whole transaction in `LocalDatabase.write`), the catch logs to Sentry, marks the batch written, and `reloadNow()`s. The reload replaces memory with the database, so the user's edit vanishes from the screen with no message. The upload side tells the user (`rejected` turns into `rejectionNotice`); this side tells only Sentry. Remedy: `toasts?.show("Couldn’t save that change")` in the catch, mirroring the web's `store.unreadable` / rejection notices. No behavior changes beyond the toast.

### F6. A locked background relaunch can leave the app on the sign-in screen, offline for good [bug] [PLAUSIBLE] [effort: S]

The Keychain item is added without `kSecAttrAccessible` (`Sync/SessionToken.swift:40-47`), so it defaults to `WhenUnlocked`. `PlaceMonitor` and two `BGAppRefreshTask`s relaunch the app in the background, often with the phone locked in a pocket. `ProcrastimateApp.init` then builds `Session`, and `Session.init` computes `signedIn = token != nil` (`Session.swift:25-26`). The token is unreadable while locked, so `signedIn` is false. When Stefan later opens that same process, `auth.start()` runs `refresh()`. Offline, `refresh()` returns from the `catch` without touching `signedIn` (line 54-56), so he sits on `SignInView` with a valid token until the network comes back. Online he sees a flash of sign-in. Remedy, either or both: set `signedIn = true` in `refresh()` as soon as `SessionToken.read()` returns a token, before the network call. Or store the token `kSecAttrAccessibleAfterFirstUnlock`, as `SharedSession` already does for the same token (`SharedSession.swift:27`), which also lets background work read it.

### F7. Five copies of "end the session", and they disagree [simplification] [CONFIRMED] [effort: S]

`SessionToken.clear(); signedIn = Launch.signedIn` appears three times in `Session.refresh` (45, 59-60, 67-68). `SyncClient.signOut` (239-252) and `SyncClient.reject` (289-293) repeat it with a PowerSync disconnect, through the weak `session` back-reference. The Session copies do not disconnect PowerSync, while the SyncClient copies do. Remedy: one `Session.end()` that clears, disconnects through `sync`, and sets `signedIn`. `SyncClient.signOut` keeps only the server `sign-out` POST, and `reject` becomes `session?.end()`. The weak `session` property then only serves `reject`, or can go if the connector's `signedOut` closure calls `Session` directly. This removes about 15 lines plus a bidirectional reference. The same steps run on every path.

### F8. `CalendarSync.sync` runs one EventKit range query per event task on the main actor [efficiency] [PLAUSIBLE] [effort: S]

`sync()` (`Calendar/CalendarSync.swift:92-102`) already fetches `upcoming` (today through +60 days). For every non-series task, `refreshed` then calls `occurrence(id, current)` (124-131), which runs a _second_ `events(matching:)` over a 67+ day window and sorts it. N event tasks mean N+1 range queries, synchronous on the main actor, on launch, on each foreground, on each `EKEventStoreChanged`, and twice at launch (`.task` plus `scenePhase == .active`). Remedy: look in `upcoming` first and fall back to the wide query only when the occurrence is not there (it moved into the past). The result is identical because `upcoming`'s window is a subset of the fallback's.

### F9. Swallowed failures that should at least log [robustness] [CONFIRMED] [effort: S]

- `PlaceMonitor.start` (`Places/PlaceMonitor.swift:63-67`): `for try await event in monitor.events` sits inside `catch {}`. If the stream ever throws, place reminders stop for the rest of the process with no trace anywhere. Log with `ErrorReport.log`.
- `TodoistImport.run` (`Import/TodoistImport.swift:33`): `try? ZipReader.entries` collapses `unsupported("ZIP64 entry …")`, `unsupported("compression method …")`, and `corrupt(…)` into "This is not a Todoist backup zip." `ios.md` names ZIPFoundation as the fallback "if Todoist zips use features the reader does not handle", but nothing records when that happens. Log the `Failure` (and show a different message for `.unsupported`).
- `SyncClient.waitUntil` (`SyncClient.swift:233`): a throwing `getCrudBatch` counts as "nothing pending", so `flush()` returns as though everything uploaded and a share request can race its task. Treat a throw as pending.

### F10. The intents' no-session fallback is dead code [simplification] [PLAUSIBLE] [effort: S]

`IntentEffects.snapshot()`, `withStore`, and `fallbackClock` (`Intents/IntentEffects.swift:6-10, 255-289`) carry a second path for `IntentSession.current == nil`, which builds `SyncClient.shared` with a clock parsed from `LaunchOptions`, and parses it in Release too. App Intents run in the app process, and `ProcrastimateApp.init` installs the session (`session.install()`, line 50) before any intent can run. No extension target compiles `Intents/`. Remedy: make `IntentSession.current` an implicitly required value (`static var current: IntentSession!`, or a `precondition`), and delete the fallback branch and `fallbackClock`, about 20 lines. If an intent did run without a session, it would now trap loudly instead of writing through a second clock, which is the user's "fail early" rule.

## Smaller notes

**`Launch` and `AppEnvironment` re-parse on every request.** `AppEnvironment.apiURL` is a computed property that re-reads and re-validates `Info.plist` on every request. A `static let` evaluated once in `ProcrastimateApp.init` keeps the early `fatalError` and drops the repeated work.

**Database open failure is a crash loop.** `SyncClient.init` and `run` `fatalError` when the PowerSync file cannot open or migrate (`SyncClient.swift:57, 86`). A corrupt file crash-loops the app forever, and only a reinstall fixes it, although the server holds the truth (apart from unuploaded writes). Showing the same "Couldn’t open your tasks" state, with a "Start over" that deletes `StoreLocation.directory`, is a product question worth asking.

**Unchecked integer conversion in `SyncedRow`.** `SyncedRow.databaseValue` (`SyncedRow.swift:100`) does `Int64(number)`, which traps on NaN, infinity, or out-of-range values and silently truncates a fractional value in an integer column. `Int64(exactly:)` with a thrown `RowCodingError` fails the same way every other bad value does.

**`DeleteAllDataIntent` asks nothing.** `DeleteAllDataIntent` (`Intents/DataIntents.swift`) wipes everything with no `requestConfirmation`, and it does not await `SyncClient.saved()` the way `withStore` does. Whether Siri or Shortcuts should confirm is a product question. The missing `saved()` is a plain inconsistency.

**`TabBar` recomputes everything on each render.** `TabBar.body` (`Navigation/RootView.swift:142-146`) computes `store.hasOpenTasks` for every pin and the full `pinGroups` (place groups, event groups, sorted labels) on every render. Every `TabBarClearance` also recomputes `barPins`. On about 1,000 tasks that is several full passes per store change, which is cheap but repeated. Computing `swaps` only inside the menu builder would remove the largest one.

**`Session.userID` is defined in the wrong file.** `Session.userID` is defined in `Screens/Sharing/PersonName.swift:32` (another slice) but is part of the session's identity logic used by `SyncClient.init`. It belongs in `Sync/Session.swift`.

**Stale doc comment in `IntentHarness`.** `IntentHarness`'s doc comment lists `open inbox|today|upcoming`, but the code accepts `inbox|no date|browse`.

**The places-notification and image-retry paths behave correctly but are subtle.** `isTaskTag("place:<id>:<ms>")` is true, so place notifications would be treated as task moments if one were ever pending. They use `trigger: nil` and never are, but a prefix check would make that explicit. `TaskImages.load` returns `false` while another load of the same key is running, which sends a second viewer into the 30 s retry even though the first load is about to succeed.

## Test coverage observations

- The App target has no tests, so these are untested: `Session.refresh`'s status handling (F1), `SyncConnector.rowWrite` (null filling, dropped tables, op ids), `LocalDatabase.read`'s cursor and trim logic, `PlaceMonitor.plan`/`armingMoment`/`conditionID`, `CalendarSync.refreshed`, and `ZipReader`. All but the first three are pure static functions over Core types. `PlaceMonitor.plan` and `armingMoment` take only `TaskItem`, `Date`, and `TimeZone`, and could move to Core (next to `Triggers`) and get `CoreTests`. `ZipReader` cannot move (it needs `Compression`), but a macOS-only test could cover it.
- `NotificationScheduleTests` cover `scheduleChange` as a pure function. The concurrency in F3 lives in the App and is not covered.
- The `./sim test` measurements in `ios.md` (offline edit uploads on the next launch, the op id after a user switch) are one-off proofs, not a regression suite, so the user-switch clear and the upload ordering (F2) have no standing check.
