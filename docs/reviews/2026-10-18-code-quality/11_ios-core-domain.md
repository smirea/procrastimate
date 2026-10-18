# iOS Core domain model and rules review

Scope (Sources/Core): Store.swift 564, StoreRules.swift 593, Views.swift 228, Triggers.swift 282, Subtasks.swift 197, TaskDetails.swift 197, Rows.swift 149, LocalRows.swift 158, Spaces.swift 99, SpaceRouting.swift 71, Screens.swift 80, Comments.swift 81, MemoTasks.swift 38, Notifications.swift 68, NotificationSchedule.swift 57, IntentRules.swift 186, Dangling.swift 39, Snapshot.swift 29, Pin.swift 37, PlaceChoices.swift 64, Browse.swift 37, Model.swift 23, JSONValue.swift 40, LaunchOptions.swift 90, AppClock.swift 25, RowActions.swift 23, QuickAddButtons.swift 44. Generated: Core/Generated/API.swift 5234 (helpers and the types the slice uses; App/Generated/SyncedTables.swift and Tokens.swift only skimmed). Tests: StoreTests 118, StoreHarness 46, WriterTests 48, APITests 15, PinnedClock 4, plus the VectorTests handler list for this slice's modules. The other test files named in the brief were checked only for which behaviors they pin.
Commit: ad9437e
Method: Read every slice file in full, then the TS originals next to them (store.ts, subtasks.ts, order.ts, space-routing.ts, views.ts, triggers.ts excerpts, rows.ts, local-rows.ts, dangling.ts, comments.ts, screens.ts, snapshot.ts excerpts, task.ts `nextOccurrence`) and compared them rule by rule: completion and roll, event-series advance, cascade delete for project, section, and task, undelete, explode and restore, fractional reorder, section moves, and fitPatch/fitToSpace. Counted the vector cases per function in `shared/vectors/*.json` for these modules. Traced callers in Sources/App (TaskRow, TaskComments, SyncClient, LocalDatabase, SyncedRow, CalendarSync, IntentEffects) where a finding depends on them. Ran one scratch Swift script (/tmp/thermo11/nan.swift) to confirm that `JSONEncoder` throws on a non-finite Double, so `try?` turns it into nil. I did not run `swift test`, because another reviewer holds the package build.

## Verdict

The port is in good shape. Every store rule I compared matches `shared/` exactly, including the subtle ones: updateTask's section and project interplay, the undo for completing a rolled event series, restoreExploded's guard for a deleted parent, and undelete's creation-order splice. About 350 vector cases pin these rules, so parity drift is unlikely. Core never reads the device zone, because every date path takes an explicit `TimeZone` from `AppClock`. The force unwraps in the slice all guard invariants the code establishes itself. What matters most:

1. `Store` keeps every space as plain arrays and has no indexes, so each visible `TaskRow` rebuilds `allTasks` and `allComments` and scans them to get its subtasks and comment badge. Each store mutation repeats that work for every visible row.
2. The JSON boundary has a silent failure mode. `JSONValue.encoding` maps an encode error to `.null`, and `Rows.diff` then turns that into "nothing changed", so the edit shows on screen but is never written. The App target has a second, throwing copy of the same helper.
   The rest is simplification: one sibling-order and move algorithm written twice, five copies of the "by createdAt then id" comparator, and a repeated update-one-by-id pattern across StoreRules.

## Findings (most important first)

### F1. Store has no indexes, so every task row is O(tasks + comments) [efficiency] [PLAUSIBLE] [effort: M]

`Store.allTasks` and `allComments` (Store.swift:143, 515) build a new concatenated array on every access, and `sharedData` (141) sorts the space keys each time. `task(_:)`, `project(_:)`, `section(_:)`, `label(_:)`, and `space(ofTask:)` (156-184) are linear scans. Each row of a list calls these several times per body evaluation (App/Screens/Lists/TaskRow.swift:123-134):

- `subtasks` runs `store.allTasks.filter { $0.parentId == task.id }` and then `groupChildren`. `progress` and `pending` both go through `subtasks`, so the full pass runs at least twice per row.
- `commentBadge` (Store.swift:521-523) filters `allComments` and rebuilds the read-marker dictionary from `snapshot.reads` for each row.
- `parent` and `project` do linear lookups, and `labels(of:)` scans the labels once per label id.
  `Store` is `@Observable` with `snapshot` as one property, so any mutation (checking off one task) invalidates every visible row, and each row then copies and scans the whole task array again. CompletedRow.swift:50, SubtaskList.swift:28, and RootView.swift:386 do the same. With 2,000 tasks, a few hundred comments, and 20 to 30 visible rows, one checkbox tap means roughly 150k element visits plus 60 or more array copies of a large struct. That is noticeable on the scroll and animate path this product cares about ("extremely snappy"). Below a few hundred tasks it does not matter.
  Remedy: derive indexes once per `snapshot` or `spaces` change, inside the Store:

```swift
@ObservationIgnored private(set) var index = StoreIndex()   // rebuilt in a didSet on snapshot and spaces
struct StoreIndex { var task: [String: TaskItem]; var children: [String: [TaskItem]]; var space: [String: SpaceKey]; var badges: [String: CommentBadge] }
public func children(of id: String) -> [TaskItem] { index.children[id] ?? [] }
public func commentBadge(_ id: String) -> CommentBadge? { index.badges[id] }
```

`children` is `Subtasks.groupChildren(allTasks)`, which is already sorted. `badges` is `Comments.commentBadges(allComments, snapshot.reads, me)` computed once rather than once per row. `space(ofTask:)` then becomes a dictionary read, and `homes` (207-215), which addTask rebuilds on every call, is the same map. Behavior stays the same because the values are the same function results, computed once. Rebuilding costs one O(n) pass per commit, and `Rows.rowWrites` already pays an O(n) pass per commit.

### F2. A failed encode silently becomes "no change"; two copies of the JSON round trip [robustness] [CONFIRMED mechanism, PLAUSIBLE trigger] [effort: S]

`JSONValue.encoding` (Rows.swift:140-144) is `try? JSONEncoder().encode(value)` and returns `.null` on failure. `Rows.fields` (90-97) then returns `[:]`. In `diff` (66-82) a changed entity runs `patch(kind, id, fields(old), fields(entity))`, which filters an empty `next` and returns no write. The store keeps the edit in memory, nothing reaches the database, and the next reload reverts it with no log. A new entity becomes a `put` with empty values, which fails later and farther away, inside `LocalDatabase.apply`. `JSONEncoder` throws on any non-finite Double (confirmed with /tmp/thermo11/nan.swift: `EncodingError.invalidValue: nan`), and `TaskLocation.latitude`, `longitude`, `radius`, and `fittedRadius` and `SavedPlace` are Doubles that come from CoreLocation and MapKit and from `Triggers.placeRadius` and `radius(atSlider:)` arithmetic. `Snapshot.swift:24-28` uses the same helper for settings, and `Store.reload` (Store.swift:83) wraps `merging` in `try?`, so an unsaved settings change that fails to merge is dropped silently. App/Sync/SyncedRow.swift:114 has a second, throwing `JSONValue.encoded` that does the same round trip.
Remedy: one `public static func encoded(_:) throws -> JSONValue` in Core, deleting `encoding` and the App copy. `Rows.fields` and `rowWrites` become `throws`. `Store.write` then traps (`preconditionFailure` with the kind and id), or `commit` refuses the command and reports it. Either way the failure surfaces at the command that caused it, not as a revert some time later. `reload` drops the `try?` and lets the merge error propagate or report. Behavior for valid data is unchanged.

### F3. `Subtasks.moveSubtask` re-implements `StoreRules.moveOrders`; two sibling comparators disagree on string order [simplification] [CONFIRMED] [effort: S]

TS has one `moveOrders` in shared/order.ts, and both `subtasks.moveSubtask` and `store.moveProject` and `moveSection` call it. The Swift port has it twice: `StoreRules.moveOrders` (StoreRules.swift:316-336, generic over `Ordered`), and an inline copy in `Subtasks.moveSubtask` (Subtasks.swift:131-157) with the same clamp, gap check, renumbering, `sameSpot` test, and midpoint table. It also has two sibling comparators. `Subtasks.siblingOrder` (10-15) breaks ties with `a.id < b.id` (Swift `String` order, which compares Unicode scalars after normalization). `StoreRules.siblingOrder` (304-311) uses `utf16.lexicographicallyPrecedes`, which is what JS `<` does. The two agree for UUIDs, so this causes no bug today, but the vectors cannot tell which one is meant to be canonical.
Remedy: make `TaskItem` conform to `Ordered` (it already has `id`, `order`, and `createdAt`), move `moveOrders` and `siblingOrder` to an internal `Order` namespace that mirrors order.ts, and reduce `moveSubtask` to:

```swift
guard let task = tasks.first(where: { $0.id == id }), let parentId = task.parentId else { return [] }
let siblings = tasks.filter { $0.parentId == parentId }
return Order.moveOrders(siblings, id, index).compactMap { id, order in siblings.first { $0.id == id }.map { var t = $0; t.order = order; return t } }
```

`Subtasks.siblingOrder` then becomes the `Ordered` one. This removes about 25 lines and leaves one place for the algorithm, like TS. The five `moveSubtask` vectors and the `moveProject` and `moveSection` vectors pin the behavior.

### F4. "By createdAt then id" is written five times with two string orders [simplification] [CONFIRMED] [effort: S]

TS has one `byCreation` in snapshot.ts, used by `sortTasks`, `sortSnapshot`, `commentsOn`, and `undelete`. The Swift copies are:

- `StoreRules.sortTasks` (34-40, utf16)
- `undelete.restore`'s insertion predicate (StoreRules.swift:526-528, utf16)
- `Spaces.sorted` (Spaces.swift:68-71), four tuple comparisons with Swift `String <`
- `Comments.commentsOn` (Comments.swift:12-16, utf16)
- `Screens.earliest` and `Triggers.open`, by createdAt only
  `protocol Created` (StoreRules.swift:557) already exists for this purpose. Add `Comment: Created`, a single `static func byCreation<T: Created>(_ a: T, _ b: T) -> Bool` using utf16, and `sorted(byCreation)` everywhere. That replaces about 20 lines with one definition and removes the second string order. The `sortTasks`, `commentsOn`, and `undelete` vectors and the `replayReads` (local-rows) vectors pin the behavior.

### F5. StoreRules repeats "copy, map, replace the one with this id" about ten times [simplification] [CONFIRMED] [effort: S]

`renameProject` (262-270), `moveProject` (279-288), `renameSection` (370-376), `moveSection` (384-392), `setPlaceRadius` (labels part, 455-461), `setLabelColor` (475-484), and `renameLabel` (493-499) each hand-write `next.X = data.X.map { e in guard e.id == id else { return e }; var e = e; e.field = v; return e }`. `put` (42-45) covers tasks only. Two small helpers on `Array where Element: Identifiable, Element.ID == String`, `updating(_ id:, _ change: (inout Element) -> Void)` and `updating(orders: [String: Double])` (for the two move commands), reduce each command to one line. For example, `renameProject` becomes `var next = data; next.projects = data.projects.updating(id) { $0.name = name }; return next`. That saves about 45 lines and leaves only the rule in each command body. Behavior is unchanged because each helper is exactly the map it replaces. The same move works in `Store` for `task`, `project`, `section`, and `label` (Store.swift:156-178): four copies of `snapshot.X.first { } ?? spaces.values.lazy.compactMap { ... }.first`, which go away entirely once F1's index exists.

### F6. Views recompute sort keys inside the comparator and group days with a linear search [efficiency] [PLAUSIBLE] [effort: S]

`Views.compare` (Views.swift:28-37) calls `sortKey` on both operands for every comparison. `sortKey` runs `Triggers.scheduledDue`: for an event task, `currentOccurrence` walks the occurrences and computes a `toDateKey` for each, and for a repeating task at a place it steps the recurrence forward. It then builds an interpolated string. A sort of n tasks therefore does about 2·n·log₂n of these, around 40k for Today or Upcoming over 2,000 open tasks. `upcomingGroups` (138-149) and `completedDays` (189-200) find each task's group with `groups.firstIndex(where:)`, which is O(tasks × days): about 600k comparisons for 2,000 upcoming tasks over 300 days. TS uses a `Map` here. Both lists are already sorted by date (the sort key starts with the scheduled date, and completed moments sort descending), so equal dates are contiguous and `groups.last?.date == date` is enough. That also makes the final `stableSorted` by date in `upcomingGroups` (148) a no-op you can delete. For the comparator, compute keys once (`let keyed = tasks.map { ($0, sortKey($0, ...)) }`, sort the pairs, then map back). Results are identical because the key is a pure function of the task, today, and zone. This matters only at the low-thousands scale, and the same decorate-sort applies to shared/views.ts.

### F7. `IntentRules.due(from:in:)` re-derives what `Dates.toDateKey` and `Triggers.wallTime` already compute [simplification] [CONFIRMED] [effort: S]

IntentRules.swift:66-73 builds a Gregorian `Calendar`, pulls components, and formats them with `String(format:)`. Core already has zone-explicit, vector-pinned helpers for both halves: `Due(date: Dates.toDateKey(date, in: zone), time: Triggers.wallTime(date.epochMilliseconds, in: zone))`. This change also removes the only `Calendar` date math from the slice, so all date logic goes through one implementation. `reminder(at:)` (76-79) stays as it is. IntentRules belongs in Core: it is pure, Foundation-only, and covered by 24 tests in IntentRulesTests. LaunchOptions is Foundation-only too, but only App/Launch consumes it and no test covers it, so it could live in App or get a CoreTests case for `parse`. Since it throws on a malformed value at launch, it already follows the fail-early rule.

## Smaller notes

- Event invariants rely on writers, because local reads skip the Zod checks. `Triggers.currentOccurrence` (Triggers.swift:28, 31) and `Views.sortKey` (Views.swift:19) index `occurrences[0]`. The generated decoder enforces `occurrences.min(1)` only under `JSONDecoder.validating()`, and only `APIClient` uses that. `SyncedRow(row:)` and `LocalDatabase.apply` decode with a plain `JSONDecoder()`. Every writer I found keeps the list non-empty (CalendarSync.refreshed returns nil on empty, and the server validates), so a crash needs bad data from outside the app. Decoding local rows with `.validating()` would turn that crash into the existing "A synced row did not load" skip. The generated `TaskEvent.init(... occurrences: [EventOccurrence] = [])` default also lets in-memory code build the illegal state, which is worth fixing in scripts/generate/swift.ts by not defaulting arrays that have a `min`.
- `Store.deleteComment` (543-547) returns the comment even when `edit` refused the change because the task is read-only, so a caller would show "Deleted comment / Undo" for a delete that never happened. TaskComments gates the UI on `isReadOnly` today, so this is latent. Return the comment only when the data changed.
- `Store.deletedFrom` (48) only grows during a session. It is tiny, but `undeleteTasks` could remove the ids it restores.
- `StoreRules.sectionTasks` (395-397) calls `descendantsOf` once per task in the section, and each call rebuilds `groupChildren` over every task, which is O(k·n log n). The delete-section prompt uses it, and so does deleteSection. Build the children map once. TS has the same shape.
- `Store.updateTask` (338-342) resolves the task's space twice, once directly and once inside `edit`.
- `TaskDetails` and `RepeatMenu` are ported from Svelte components (TaskDetails.svelte:66-94, RecurrencePicker.svelte:30-84), not from `shared/`, so no vector pins them. I found no drift today: the draft merge, the section rule on project change, and presets, `set`, `toggling`, and `custom` all match. Two edge differences exist: web `custom` keeps only one of `nth` or `day`, and web `same` and Swift `==` differ only when both fields are set. These rules are the most likely to drift next, and moving them to `shared/task-details.ts` with vectors would close the gap (cross-slice).
- Settings with a pending change before the row arrives (`setSettings`, `reload`) look correct and are pinned by WriterTests. `reload`'s write-barrier (`writtenVersion == version`) is sound, because SyncClient calls `written` on both the success and failure paths.
- Generated API.swift: I found no duplication with the handwritten code. Core typealiases the generated types, and `decodeAbsent`, `decodeNullable`, and `encodeNullable` are only in the generated file. `TaskPatch` uses `T??` for nullable fields, so `apply(to:)` (StoreRules.swift:13-28) clears a field on `.some(nil)` correctly. The 30 `updateTask` vectors pin this.

## Test coverage observations

- Vectors cover the pure rules thoroughly (store 123 cases, subtasks 19, views 35, triggers 51, rows 19, local-rows 7, dangling 7, comments 13, screens 41, space-routing 12, notifications 20). What they do not cover is the `Store` class itself. Its shared-space routing (read-only guards, `fitPatch` against the right space, explode only on own, `deletedFrom` for undo) is covered by SpaceTests only for the main paths. `undelete` after `deleteProject` through `Store`, `suggestColor` and `untouchedLabels`, and `markCommentsRead` going to the own space while the comment lives in a shared one have no Store-level test.
- `Rows.fields`, `JSONValue.encoding`, and `Settings.merging` have no failure-path test. F2's silent drop would pass every current test.
- `LaunchOptions.parse` has no test.
- `TaskDetails`, `RepeatMenu`, and `ReminderMenu` are tested in TaskDetailsTests against hand-written expectations, not shared vectors, so web and iOS can drift without a failing test.
- StoreTests assert on observable results (written rows, task order, undo), not on implementation details. That is the right style.
