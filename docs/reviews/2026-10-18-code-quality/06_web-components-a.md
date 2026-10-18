# Web client, large interactive components review

Scope (lines): QuickAdd.svelte 542, SmartInput.svelte 339, TaskDetails.svelte 341, Search.svelte 312, ShareSheet.svelte 269, TaskRow.svelte 244, DuePanel.svelte 242, RowMenu.svelte 183, TaskComments.svelte 182, Subtasks.svelte 174, RecurrencePicker.svelte 163, Settings.svelte 167, AiAccounts.svelte 152, TitleFlow.svelte 141, Popover.svelte 134, LabelPicker.svelte 132, ImageViewer.svelte 125, ThemeSwitcher.svelte 122, QuickAddButtonSettings.svelte 89, NameSuggestions.svelte 65, QuickAddMenu.svelte 62, ramble/RambleDrawer.svelte 598, ramble/Waveform.svelte 60 (4838 total). Also read, to judge them: ui.svelte.ts, row-menu.svelte.ts, names.ts, caret.ts, completion.ts, subtask-draft.ts, quick-add-buttons.ts (web and shared), the relevant parts of store.svelte.ts, shared/quick-add.ts (assembly part), shared/name-search.ts `lastUsed`, shared/comments.ts, shared/ramble-fill.ts, shared/search.ts `search`, todoist-import.ts, TaskList.svelte, index.css component layer.
Commit: ad9437e
Method: Read every file in the slice in full, then traced callers and callees with grep (store writes, Popover users, TaskRow users, CSS layers for tap targets). Ran `bun run --cwd app-web check` once (0 errors, 0 warnings). Wrote two scratch benchmarks under /tmp/procrastimate-thermo/: `bench06.ts` (parseQuickAdd per keystroke: 0.12 ms, so not a problem) and `bench06b.ts` (shared `search()` per keystroke over 3000 tasks: 7 ms in Bun). Checked the e2e specs and feature maps for pins on each claimed behavior. Most of the time went to QuickAdd, TaskDetails, SmartInput, RambleDrawer, and Popover/RowMenu.

## Verdict

The slice is in decent shape. The Svelte 5 usage is mostly correct, svelte-check is clean, listeners and observers are cleaned up, and the parser is cheap enough to run on every keystroke. The most important finding is a real data bug: task details never pick up a title change that arrives while the sheet is open, and blurring the title field writes the stale title back over it (F1). Next come several tap targets under the 44 px rule in AGENTS.md (F2), and a per-row Popover in TaskRow. That Popover puts four window listeners on every list row and duplicates the shared row menu's postpone list (F4). The structural problem is QuickAdd.svelte. Its draft model is about 200 lines of intricate logic with no unit test, mixed into markup, and parts of it are reimplemented in TaskDetails and `rambleNewTask` (F6).

## Findings (most important first)

### F1. Task details keeps a stale title and writes it back over a remote rename [bug] [CONFIRMED by trace] [effort: S]

`TaskDetails.svelte:55` seeds `let title = $state(untrack(() => task.title))` once. Nothing updates it after that. TaskSheet keys details by task id, so the component stays mounted while that task is open, and `task` keeps updating from sync. Say the task is renamed while details are open, from another device, the other tab, or an AI account through the agent API. Three things follow:

1. The Title field keeps showing the old text.
2. `title !== task.title` is now true, so `draft` (`:67`) runs and the chips show values parsed from the old title instead of the task.
3. If the field has focus, the next blur or Enter runs `commitTitle` (`:87`). That calls `update({ title: next, ... })` with the old title and silently reverts the other device's rename.

No spec pins this (sync.e2e.ts only renames with details closed on the other side). Remedy: keep the local value only while the user is editing, so the input is driven by `task.title` otherwise:

```svelte
let edit = $state<string | null>(null);
const title = $derived(edit ?? task.title);
// <SmartInput bind:value={() => title, (v) => (edit = v)} ... />
// commitTitle: ...update(...); edit = null;   Escape: edit = null
```

`parsed`, `draft`, and `commitTitle` keep their logic and read `title` as before. Behavior is unchanged for local edits. A remote rename now shows up whenever the field is not being edited, and a blur with no typing commits nothing.

### F2. Tap targets under 44 px on phones [bug] [CONFIRMED by CSS reading] [effort: S]

AGENTS.md and ux-principles.md require 44 px with `touch:` or `hit-area`. `.icon-btn`, `.chip`, and `.btn` sit in `@layer components` (index.css:191), so a `size-*` utility overrides their 2.75rem touch size. These buttons have neither `touch:size-11` nor `hit-area`:

- `TaskRow.svelte:216`, the `Postpone <title>` button: `size-8`, so 32 px. It is the main postpone path on a phone ("On touch screens the button is always visible, so a phone taps it directly").
- `TaskComments.svelte:110,113`, Edit comment and Delete comment: `icon-btn size-7`, so 28 px on touch.
- `QuickAdd.svelte:363`, the Ramble mic in the title field: `size-8`, so 32 px.
- `ShareSheet.svelte:247-267`, `.role-option` (Can edit / Can view): 2rem, raised only to 2.5rem (40 px) under `(pointer: coarse)`. That media query is narrower than the project's `touch` variant (`(max-width: 767px), (pointer: coarse)`), so a 393 px window with a fine pointer gets 32 px.

Only the theme switcher has a size assertion (phone.e2e.ts:38). Remedy: add `hit-area relative` (or `touch:size-11`) to the first three, and use `touch:h-11` on the role options. A cheap guard would extend phone.e2e.ts to assert `boundingBox` ≥ 44 for every visible `button` in quick add, details, and share at 393 px.

### F3. Todoist import reports any import failure as "not a Todoist backup zip" and drops the error [robustness] [CONFIRMED] [effort: S]

`Settings.svelte:43-51` wraps both `readBackupZip(file)` and `store.importBackup(backup)` in one `try { } catch { }`. The catch has no binding and no `reportError`. A bug in `mergeBackup`, `rules.sortTasks`, or `#apply` shows the user "This is not a Todoist backup zip." and never reaches Sentry, against observability.md's rule that failures report. Remedy: limit the try to `readBackupZip`, and let `importBackup` throw or call `reportError` and show a different message. Also disable the import button while `status.kind === 'reading'`, because a second pick now runs a second import concurrently and the two race on `status`.

### F4. Every task row mounts its own Popover: 4 window listeners per row and a second copy of the postpone menu [efficiency + simplification] [CONFIRMED by reading] [effort: M]

`TaskRow.svelte:212-235` mounts a `Popover` for every open, editable, non-event row. `Popover.svelte:97-102` registers `<svelte:window onkeydowncapture onpointerdowncapture onscrollcapture onresize>` unconditionally, open or not. A list of 500 open tasks therefore holds 2000 window listeners, and every scroll event in any scroller, every pointerdown, and every keydown runs 500 no-op handlers. row-menu.svelte.ts:13 states the opposite design goal: "One menu for every row, mounted once at the root, so a long list pays nothing per row until one opens". The rendered postpone list (`postponeOptions` + `WEEKDAY_NAMES` buttons, TaskRow:221-232) is also a copy of RowMenu.svelte:147-157.

Remedies, which can be done independently:

1. In Popover, attach the window listeners inside the `show` attachment (only while open) and return their removal. This helps every picker and needs no change to any caller.
2. Have the row's postpone button open the root `RowMenu` with a `postponeOnly` flag (`rowMenu.openBelow({ task }, button, { only: 'postpone' })`). That deletes the per-row Popover and its snippet (~22 lines) and leaves one postpone renderer.

Behavior is preserved if the menu keeps the button as its anchor and its options (the same `postponeOptions(scheduledDue(...))`). The feature map says no automated test covers row postpone, so add one when moving it.

### F5. The ramble waveform redraws at 60 fps for as long as the drawer is open, including the whole review phase [efficiency] [CONFIRMED] [effort: S]

`Waveform.svelte:28-55` schedules `requestAnimationFrame(draw)` unconditionally. Once `active` goes false, `presence` decays to zero within about a second. After that the loop keeps clearing the canvas, doing 41 `roundRect` fills, and calling `getComputedStyle` every 30 frames while Stefan edits the reviewed list on his phone. Remedy: stop scheduling when `!listening && presence < 0.005 && smoothed < 0.001`, and restart the loop from the `$effect` that mirrors `active` (it already exists at :15). No visible change, because the frames it stops drawing are blank.

### F6. QuickAdd.svelte mixes a 200-line draft model with markup, and its merge rules are reimplemented in TaskDetails and `rambleNewTask` [simplification] [CONFIRMED] [effort: M]

`QuickAdd.svelte:46-312` holds a full model in the component: picked attributes and typed attributes and their precedence, token cutting with the reparse loop (`clearToken`, `cut`), label/place reconciliation (`setLabels`, `typedPlaceId`, `isPlace`, `labelIdOf` duplicated by `labelTokens`), `setRecurrence` with a `JSON.stringify` due compare, subtask drafting, and the submit payload. The rest of the file is chip-row layout (scroll fades, `intoView`, ResizeObserver) and 200 lines of template. None of the model is unit-testable today, and `setLabels` (:178-187) is the most intricate branch in the slice.

The same rules exist in other places:

- "A typed project other than the current one leaves the section behind": QuickAdd:107 `parsed.sectionId ?? (projectId === picked.projectId ? picked.sectionId : null)`, TaskDetails:76 `parsed.sectionId ?? (parsed.projectId && parsed.projectId !== task.projectId ? null : task.sectionId)`, and `shared/ramble-fill.ts:22` `ownProject`.
- "An event stands in for date and repeat": QuickAdd:146 and :252-253, TaskDetails:72-73, and ramble-fill.ts:33-34.

Remedy: move the model into `app-web/src/lib/quick-add-draft.svelte.ts`, a class with `text`, `picked`, `$derived` parsed/values/applied, and methods `clearToken`, `setLabels`, `setRecurrence`, `toNewTask()`. Put the base-plus-typed merge in one pure function in `shared/` (say `typedOver(base, parsed)`, returning due/recurrence/priority/projectId/sectionId/labelIds/reminders), used by QuickAdd, TaskDetails' `draft`, and `rambleNewTask`, with a `bun test`. QuickAdd.svelte drops to roughly 300 lines of layout and template. Behavior is identical because the code moves unchanged; only the duplicated section/event rules collapse into the one shared function. The iOS port likely has a fourth copy (outside this slice, not checked).

### F7. The sheet shell and anchored-panel placement are each implemented several times [simplification] [CONFIRMED] [effort: M]

- Five sheets copy the scrim, the dialog, and the `enter` transition (fly from the bottom on mobile, scale on desktop): QuickAdd:314-342, Search:123-138, TaskSheet:10-16, ShareSheet:136-141 (fly only, which is an inconsistency on desktop), and SettingsSheet:9, with RambleDrawer:210 a variant. A `Sheet.svelte` taking `label`, `class`, and children would remove about 10 lines from each and give one place for focus and Escape.
- Three components compute floating-panel placement with their own viewport and visualViewport clamping and flipping: `Popover.place` (:37-54), `RowMenu.show` (:44-60), and `SmartInput.place` (:169-176). Popover and RowMenu also each have the same `returnFocus` / `$effect.pre` focus-return block (Popover:56-77, RowMenu:39-69). One `placePanel(anchorRect, panel, { align, prefer })` helper in `ui.svelte.ts` plus one `returnFocusOnClose` attachment would cover all three.

Behavior stays the same if each caller passes its current preference (below vs above, pointer vs anchor).

### F8. Search re-folds every task's text on each keystroke: 7 ms per keystroke at 3000 tasks [efficiency, mostly cross-slice] [baseline CONFIRMED, fix PLAUSIBLE] [effort: S]

`Search.svelte:41` derives `search(query, store.own.tasks, ...)` on every input. `shared/search.ts:120-121` (`scoreTexts`) calls `fold` on every title, notes, project, and label string of every task for every query. `/tmp/procrastimate-thermo/bench06b.ts` (3000 tasks with about 500 characters of notes) measures 7.0 ms per keystroke in Bun. A phone WebKit is plausibly 2-3x slower, which leaves little of a 16 ms frame. The store keeps task object identity across unrelated changes (`keepSame`), so caching the folded fields in a `WeakMap<Task, Folded>` inside shared/search.ts would leave per-keystroke work at term matching only. Results are unchanged. The fix belongs to the shared/search owner. This component needs no change.

## Smaller notes

**Effects that should be handlers.** `$effect(() => { void query; active = 0; })` appears in Search:72, LabelPicker:59, and, in a variant, SmartInput:178. Resetting in the field's `oninput` says the same thing without an effect. In SmartInput the effect also depends on the `fragment` object itself. `fragment` is rebuilt whenever `sources` changes (any sync touching projects, labels, or sections), so a sync arriving mid-navigation resets the highlighted suggestion to the first one. `LabelPicker:64` (`if (open) query = ''`) and `RecurrencePicker:47` are open-transition handlers written as effects. Two effects are only `onMount` in disguise: QuickAdd:225 (`rowReady`) and TaskDetails:130 (scroll restore).

**Dead check.** RambleDrawer:348's `!live.includes(entry)` can never be false in review: `settle()` clears `live`, and `onText` returns early in review.

**Two writes per ramble task with notes.** Ramble save does `addTask` then `updateTask({ notes })` (RambleDrawer:153-159), because `NewTask` has no `notes` (shared/store.ts:37-51). Adding `notes` to `newTaskSchema` would make it one command per task (cross-slice).

**Casts that a generic removes.** `rowButtons(...) as WebButton[]` appears in QuickAdd:145 and QuickAddButtonSettings:12. Typing the shared function as `rowButtons<B extends QuickAddButton>(visible, shown: readonly B[], supported: readonly B[]): B[]` removes both casts.

**Index pairing of reminders.** QuickAdd:469-472 pairs reminder tokens with `parsed.reminders[i]!` by index. This is correct today only because a single repeatable rule produces reminders in text order. Having the parser return `{ token, reminder }` pairs would remove the hidden coupling.

**Reduced-motion query read directly.** TaskRow:74 calls `matchMedia('(prefers-reduced-motion: reduce)')` directly, while ui.svelte.ts already owns `reducedMotion`. Export it.

**Misleading empty states when offline.** AiAccounts:28-33 shows the "An AI account can read and edit..." empty state when the list request fails offline, where ShareSheet shows "Sharing needs a connection". ShareSheet:61-62 turns a failed people search into "No one found. Try their full email."

**Attachment churn in Search.** Search:208 builds a fresh `taskMenu(...)` attachment for each result row on every keystroke, because the `row` objects are recreated each time. That tears down and re-adds seven listeners per visible row per keystroke. It is cheap at 45 rows, but `{@attach taskMenu(() => ({ task: row.hit.task }))}` on a component keyed by task id would avoid it.

**Index-keyed token segments.** SmartInput:211 keys segments by index, so inserting a token before existing ones remounts the later `<mark>`s and replays their `token-in` animation.

**Per-keystroke `lastUsed`.** SmartInput:97 recomputes `lastUsed(store.tasks, ...)`, which is O(tasks), on every keystroke while a suggestion list is open. Hoisting it to its own `$derived` per source makes it once per store change.

**ImageViewer focus.** It focuses itself but neither traps Tab nor returns focus to the thumbnail on close.

**Duplicated `.heading` style.** The same `.heading` style block is copied in Settings, AiAccounts, and ShareSheet. It belongs in index.css.

**Ramble project picker drops the section.** RambleDrawer passes `sections={[]}` and ignores `place.sectionId`. That is consistent with ramble.md, which lists only the project picker; noted only so nobody "fixes" it by accident.

## Test coverage observations

**Draft model.** QuickAdd's draft model (label/place reconciliation, `clearToken`'s reparse loop, recurrence-with-start) is covered only through e2e. Extracting it (F6) would allow literal-value unit tests.

**Remote edits in details.** No spec covers a remote change to a task while its details are open (F1). A two-device case in sync.e2e.ts would pin it: rename on B with details open on A, then assert that A's Title field updates.

**Tap targets.** Only the theme options are checked at 44 px (phone.e2e.ts:38).

**Row postpone.** The row postpone popover has no automated test, as edit-task.md says.

**Waveform.** The Waveform loop and the ramble drawer's keyboard map (Space, Enter, Escape by phase) have no tests that target them. ramble.e2e.ts drives the flow but not the keys.

**Render behavior.** TitleFlow's clamp and float measurement and SmartInput's suggestion placement are layout behaviors that only manual WebKit runs exercise.
