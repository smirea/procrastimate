# Shared domain model and rules review

Scope (lines): store.ts 540, task.ts 217, views.ts 262, triggers.ts 274, subtasks.ts 141, screens.ts 116, order.ts 42, rows.ts 107, local-rows.ts 108, snapshot.ts 107, model.ts 92, dangling.ts 57, scope.ts 168, sharing.ts 252, comments.ts 83, memo-tasks.ts 67, notifications.ts 55, push.ts 24, values.ts 220, todoist.ts 407, images.ts 47, label-colors.ts 59, space-routing.ts 89, row-actions.ts 21, id.ts 12, kinds.ts 3, auth.ts 23, testing.ts 61, sentry.ts 55, theme.ts 6, plus db/json.ts 49 and zoned-time.ts 84. Their tests were skimmed for pinned behavior.
Commit: ad9437e
Method: Read every file in the slice in full, plus server/src/access.ts, writes.ts, commands.ts (task commands), space.ts (loadTree/loadLinks), memo-tasks.ts, and the web/iOS callers of the tree helpers. Read the decision files domain, recurrence, subtasks, places-and-events, comments, sharing. Ran the slice's 14 unit test files (343 pass). Wrote scratch probes under /tmp/procrastimate-thermo/s02/: an end-to-end PGlite test through `/api/upload` (hijack.test.ts), zone probes run under `TZ=UTC` and `TZ=Europe/Berlin` (zone.ts), schema probes (days.ts), store edge probes (probe.ts), and four micro-benchmarks (bench*.ts).

## Verdict

The pure rules are mostly sound and well pinned by tests. Recurrence math, ordering, dangling resolution, and undo all hold up. The one serious problem is authorization. `guestRefusal` treats "no `access` row for this task id" as "a new task", so a guest with any edit share on a project or label can patch or re-put **any** task in the owner's space whose id it knows, and the server applies the write. I reproduced this end to end. Second: event-series completion ignores the user's zone, so on the server (UTC) it skips or keeps the wrong occurrence for part of each day. After those come a few schema holes that let illegal recurrences and dates in, and three cheap efficiency fixes (an uncached `Intl.DateTimeFormat` that makes server push planning about 20x slower, a per-root `groupChildren` rebuild that runs on every store change of a project screen, and `rowWrites` deep-comparing unchanged objects).

## Findings (most important first)

### F1. A guest can overwrite any owner task it knows the id of [bug] [CONFIRMED] [effort: S]

`shared/scope.ts:146-154`: for a task write, `role = roleOf(rows, 'task', write.id)`. When the guest has no row for that id (`role === undefined`), the code assumes the task is new and only asks `mayAdd(fields, rows)`. It never checks the op. The result: a `patch` (or a `put`) on an existing task that the guest cannot see passes as long as the write names a project or label the guest holds `edit` on. On the server, `applyWrites` (`server/src/writes.ts:279-311`) routes the patch through `storedRows` to the owner's space, and `guestRefusal` returns null. Then `statement` runs `UPDATE tasks ... WHERE user_id = owner AND id = ...` (`writes.ts:166-178`). A put goes through the upsert, whose `setWhere: tasks.userId = excluded.user_id` matches the owner's row because the guest sends `user_id = owner` (`writes.ts:134-147`).

Reproduction (`/tmp/procrastimate-thermo/s02/hijack.test.ts`, run with `bun test`): the owner creates project Garden and a private task "Private diary" with no project, then shares Garden with the guest as `edit`. The guest uploads `{op:'patch', table:'tasks', id:<private id>, values:{project_id: Garden, title:'Overwritten by guest'}}`. Result: `rejected []`, and the stored row's title is "Overwritten by guest" in project Garden. A guest put with `taskRow(<private id>, owner, 'Put by guest', {projectId: Garden})` also lands. A guest learns ids easily: any task that was once shared with them and then moved out of their scope, any id in a public link, or an id in the activity log.

`shared/scope.test.ts:32-40` pins "a new task needs an edit row for its parent, project, or label" only with ids that really are new. Nothing tests an existing id without a row.

Remedy:

- In `guestRefusal`, refuse a `patch` whenever `role !== 'edit'`, since a patch never creates a row: `if (write.op === 'patch' && role !== 'edit') return REFUSED`.
- For a `put` with `role === undefined`, the server must not let it update an existing row. In guest mode (`land(..., inTransaction=true)` from `asGuest`), make the task upsert `onConflictDoNothing` when the guest holds no row for the id. Alternatively, pass `exists` into `guestRefusal` the way `stored` is passed for comments, and refuse.

Every legitimate guest flow is unchanged. Guests edit tasks they have `edit` rows for, and they create tasks with new ids.

### F2. Event-series completion uses the process zone, so the server skips the wrong occurrence [bug] [CONFIRMED] [effort: S]

`shared/subtasks.ts:77-83` `nextEventOccurrence` calls `currentOccurrence(event, today)` and `occurrenceDue(event, rest[0])` without a zone. `currentOccurrence` compares `zonedDateKey(anchor, zone)` to `today` (`triggers.ts:48`). The server's `finishTask` (`server/src/commands.ts:252-256`) passes `today = zonedDateKey(now, zone)` in the owner's zone, but each occurrence's day is computed in the Worker's process zone (UTC). Probe (`/tmp/procrastimate-thermo/s02/zone.ts`): the user is in Europe/Berlin, it is 00:30 local on Oct 19, and a series has occurrences at 01:00 Berlin on Oct 19, 20, and 21. Under `TZ=Europe/Berlin` (the client), completing moves the task to the Oct 20 occurrence. Under `TZ=UTC` (the server), it moves to the Oct 21 occurrence, dropping one, and the reported `next` reads `23:00` (UTC wall time). For zones west of UTC the error runs the other way: an occurrence already past locally counts as current, so the roll only removes a stale occurrence. The task stays on today's occurrence, so the completion has no visible effect. Every non-UTC user has a window of |offset| hours each day when an agent completion of a series task is wrong.

Remedy: add an optional `zone?: string` to `subtasks.completeTask` and `store.completeTask`, pass it to `currentOccurrence` and `occurrenceDue`, and pass `zone` from `finishTask` (it already has it). Clients keep passing nothing, so their behavior and the existing vectors are unchanged. The Swift port gains the same optional parameter. `eventGroups` (`triggers.ts:265`) has the same zone-less `currentOccurrence`, but only clients call it today.

### F3. The value schemas admit recurrences, dates, and trigger combinations the rules mishandle [bug] [CONFIRMED] [effort: S]

Three holes in `shared/values.ts`. The agent API's `TaskPatch` (`store.ts:56`) and every upload accept them as is.

1. **Weekday sets need not be sorted or unique.** `values.ts:83` only says `days: z.array(weekdaySchema).min(2)`, but `stepRecurrence` (`task.ts:157-160`) relies on Monday-first order (`find` takes the first listed day after today, and `days[0]` is taken as the week's first day). Probe: `{interval:1, unit:'week', days:[5,3,1]}` parses, and stepping from Monday 2026-10-19 gives Friday 10-23 instead of Wednesday 10-21. `days:[1,1]` also parses. Remedy: `.refine(d => d.every((day, i) => i === 0 || mondayIndex(day) > mondayIndex(d[i-1])))`, so the server rejects the write. (A transform would also work, but the schema feeds the Swift generator, and a refine leaves that untouched.)
2. **`DateKey` and `TimeOfDay` are shape-only regexes.** `'2026-02-31'` and `'25:99'` parse (`dueSchema.safeParse` succeeds). `fromDateKey` then quietly rolls the date over to March 3, and `zonedTime` computes a moment the user never typed. Remedy: refine both schemas on round-trip (`toDateKey(fromDateKey(k)) === k`, hours < 24, minutes < 60). Their JSON Schema `pattern` stays the same, so the Swift side is unaffected.
3. **An event together with `due`/`recurrence`.** places-and-events.md says "An event replaces the due date and the repeat, so setting one clears both", but nothing enforces it. `updateTask` accepts `{recurrence}` on an event task. The rules then disagree. `subtasks.completeTask` checks the recurrence first (`subtasks.ts:94-96`), while `scheduledDue` puts the event first (`triggers.ts:80`). Probe: a weekly-repeating task on a series event, completed on 10-19, reports `rolled, next 2026-10-26`, but the list still shows it at the event's 10-19 09:00. Remedy: make one precedence rule (`const next = series ?? occurrence`, with the event first, matching `scheduledDue` and the docs), and have `updateTask` clear `due` and `recurrence` when the patch sets an `event`. A `superRefine` on the task's fields would reject both together outright, but rows already stored may hold both, so make the rules consistent first. Vectors do not change unless one of them records an event-plus-recurrence task (none do today).

### F4. `wallTime` constructs an `Intl.DateTimeFormat` on every call, about 20x slower server push planning [efficiency] [CONFIRMED] [effort: S]

`triggers.ts:51-66` builds a new formatter per call whenever a zone is given. `zoned-time.ts:10-28` already caches formatters per zone. The server's `replan` (`server/src/push.ts:31`) calls `upcomingNotifications(..., zone)` after every write that touches push. For each event task it calls `occurrenceDue` once per occurrence (up to 10). Benchmark (bench4.ts, 200 series tasks × 10 occurrences plus 2000 dated tasks): 73 ms with `zone='Europe/Berlin'` against 3.5 ms without one. Constructing the formatter accounts for almost all of the difference (4000 constructions take 57 ms against 2 ms cached). That CPU time is spent on a Worker after each such write. Remedy: export `zonedTimeOfDay(at, zone)` from `zoned-time.ts` built on its cached `wallClock`, and make `wallTime` a two-line branch. Output is identical.

### F5. `descendantsOf` rebuilds and re-sorts the whole child index on every call; `sectionTasks` calls it once per task [efficiency] [CONFIRMED] [effort: S]

`subtasks.ts:42-53` runs `groupChildren(tasks)`, a full pass plus a sort per sibling group, on each call. `store.ts:399-401` `sectionTasks` calls it for every top-level task in the section, and `app-web/src/lib/components/ProjectSection.svelte:31` does `$derived(sectionTasks(store.tasks, section.id).length)` for every section on the project screen. That derivation reruns on every change to `store.tasks`. Benchmark (bench2.ts, 2000 tasks, 10 sections of 100): 11.8 ms per store change, against 0.8 ms with one shared child map. `server/src/memo-tasks.ts:162-165` repeats the pattern, and so does the iOS port (`StoreRules.swift:396`, which `ProjectScreen.swift:49` calls in its body). `queue.shift()` adds a quadratic factor on wide trees as well.

Remedy: let `descendantsOf` take the prebuilt map, or add `descendantsOfAll(tasks, ids)` that builds `groupChildren` once and walks each root in turn with an index cursor instead of `shift`. `sectionTasks` then keeps the exact output order `[t, ...descendants(t)]` per root, so the recorded vectors stay identical.

### F6. `rowWrites` deep-compares every entity even when the store passed the same object through [efficiency] [CONFIRMED] [effort: S]

`rows.ts:46-58` runs `fieldsOf` and `sameValue` over all of an entity's fields for every task in both snapshots on every command. The store rules keep the same object for each unchanged entity (`put` returns `t`, and `sortTasks` keeps references). Benchmark (bench3.ts): a single title edit with 3000 tasks costs 2.8 ms in `rowWrites`, and the result is one patch. Remedy: `if (old === entity) continue;` before `fieldsOf`. Two identical references cannot differ, so the output is the same.

### F7. `updateTask` with a `projectId` on a subtask writes a value that every reader then discards [robustness] [CONFIRMED] [effort: S]

`store.ts:213-227` applies `patch.projectId` to the subtask and its descendants, but not to its root. `resolveDangling` (`dangling.ts:38-53`) then resets every subtask's project to its root's. Probe: after `updateTask(data, 'kid', {projectId:'work'})` the stored row says `work`, and the read says `home`. The web UI hides the project picker on subtasks, but the agent API's `editTask` (`server/src/commands.ts:241-250`) passes the patch through. The write lands and is logged (activity says "moved it to …"), and nothing changes. Per the user's fail-early rule, either drop `projectId` for a subtask in `updateTask` (`task.parentId !== null ? omit : …`) or throw from `editTask`. Relatedly, `addTask` with a `parentId` that does not exist quietly creates a top-level task (`store.ts:179`, probe confirmed). The server checks `visibleTask(parentId)` first, so this only matters for client races. Note it, but it is not worth a change.

### F8. Snapshot, store, and model restate the same shapes and comparators [simplification] [CONFIRMED] [effort: S]

The same code is written out more than once:

- `byCreation` appears in both `store.ts:151` and `snapshot.ts:28`. `sortTasks` (`store.ts:155`) is the `tasks` line of `sortSnapshot`.
- The id tiebreak `a.id < b.id ? -1 : a.id > b.id ? 1 : 0` is hand-written in `order.ts:13`, `store.ts:152`, `snapshot.ts:29,31`, `views.ts:82,222`, `triggers.ts:257,272`, and `space-routing.ts:72`. One exported `compareIds` covers them.
- `storeDataSchema` (`store.ts:14-28`) lists the same six arrays as `snapshotSchema` (`model.ts:80-90`). It can be `snapshotSchema.omit({ settings: true }).meta({ id: 'StoreData', … })`.
- `entitiesOf` and `withEntities` (`snapshot.ts:45-91`) are two seven-case switches whose keys are exactly `TABLE_OF` (`rows.ts:16-24`). Snapshot keys equal table names for every kind except `settings`. With one `settings` branch and `snapshot[TABLE_OF[kind]]`, about 40 lines and six `as unknown as` casts go away.
- `open` appears in both `views.ts:54` and `triggers.ts:199`.
- `addSection` re-inlines `takenIn` (`store.ts:377` against `364`). Case-insensitive name equality is also written out in `savePlace`, `renameLabel`, and `todoist.ts:296`.
- `push.ts:16-17` aliases `ScheduledPush` to `ScheduledNotification` with no difference between them.

Behavior and vectors are unchanged, because the comparators and shapes are identical.

### F9. `scopeOf` walks to each task's root, but every caller already passes resolved links [simplification] [CONFIRMED] [effort: S]

`scope.ts:37-49` builds `byId` and walks parents with a cycle guard to find the root project. Every caller passes `resolveDangling` output: `loadLinks` and `loadTree` (`server/src/space.ts:40,65`) feed `accessRows`, `visibleOf`, and `sharedView`. In that output each task's `projectId` already is its root's and cycles are gone (`dangling.ts:32-53`). `rootProject(task)` reduces to `task.projectId`, which deletes `byId`, the walk, and the guard (about 12 lines). Encode the precondition in the type rather than in a comment: have `resolveDangling` return a branded `Resolved<T>` and make `scopeOf` take `Resolved<Links>`. The brand also protects the BFS at `scope.ts:72-77`, which has no visited set and would never terminate on a parent cycle if someone passed unresolved rows.

### F10. Reopen's undo state is rebuilt by hand on both clients [simplification] [PLAUSIBLE] [effort: M]

`store.completeTask` returns `previous` for undo, but `store.reopenTask` returns only data. So `app-web/src/lib/completion.ts:22-36` and `app-ios/Sources/App/Screens/Lists/TaskActions.swift:33-50` each recompute "task plus completed ancestors" with `ancestorsOf` and assemble `CompletionState`s themselves. Have `reopenTask` return `{ data, previous }` the way `completeTask` does, and delete both copies. The two clients currently differ slightly: the web reads the live fields at undo time, a choice its comment documents. Keep that by returning only `{id, completedAt}` pairs and filling the rest at undo. Relatedly, `subtasks.completeTask` has exactly one caller (`store.completeTask`), and its `SubtaskCompletion` schema exists only to be converted to `Completion`. Merging the two removes a schema and a Swift type. Both changes alter the recorded vectors (`store.reopenTask`, `subtasks.completeTask`).

## Smaller notes

`views.ts:38-52`: the `compareTasks` comparator calls `sortKey`, and through it `scheduledDue`, on every comparison. That is about 2·n·log n calls, each of which may step a recurrence at a place forward or scan event occurrences. At 3000 tasks `todayTasks` measures 1.9 ms, so precomputing keys is optional. `completedDays` (`views.ts:230`) and `noDateTasks` (`views.ts:86`) grow groups with `[...old, task]`, which is quadratic per group (6 ms at 3000 completed tasks on one day, as after an import). Use `push`.

`guestRefusal`'s `pointsOutside` lets a guest with edit on a task send `projectId: null` or `parentId: null`, which moves the owner's task into the owner's Inbox, or detaches it, and out of the guest's own sight. This is a product question: is "remove from the shared project" a guest's right?

`todoist.ts:364-405`: `nextSiblingOrder(tasks, parent.id)` and `tasks.findIndex` run per imported task, which makes the import O(imported × stored). That is a few million operations for a 2000-task backup, so it is fine, but one map would remove it. `store.ts:457-458`: `undelete` filters every labeling for every task. The same applies. `images.ts:19-23` still justifies the size limits with the Durable Object's SQLite and Turso, both gone since the Postgres move.

## Test coverage observations

- No test (shared or server) for a guest `patch`/`put` on an existing task id that has no `access` row (F1). `scope.test.ts` uses only truly new ids for the "new task" rules.
- No test completes an event-series task with a `zone` or under a non-local process zone (F2). `subtasks.completeTask` has no zone parameter to test.
- No schema tests reject unsorted or duplicate `days`, impossible calendar dates, or `25:99` times (F3). No test covers a task with both an event and a recurrence.
- `updateTask` tests cover a section on a subtask (`store.test.ts:470`) but not a `projectId` on a subtask (F7).
- The rest of the store rules, recurrence (task.test.ts), dangling, rows, and local-rows are tested by behavior with literal expectations and recorded as vectors. Coverage there is good.
