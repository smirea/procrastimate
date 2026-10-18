# Web routes, layout, remaining components, and styles review (slice 07)

Scope: `app-web/src/routes/` (+layout.svelte 241, +layout.ts 2, +page.ts 5, inbox 68, no-date 47, completed 39, projects/[id] 174, labels/[id] 176, places/[key] 66, events/[id] 19, s/[token] 86), `index.css` 540, `app.html` 42, and the 33 listed components in `lib/components/` (2047 lines total: Sidebar 226, ProjectSection 120, ProjectPicker 116, CompletedRow 117, Calendar 117, DictationSwitcher 114, ReminderPicker 96, SignIn 88, TaskImages 88, TaskActivity 88, ProjectList 84, CompletedRangePicker 76, View 73, Checkbox 70, Toasts 54, PriorityPicker 50, SectionHeading 43, DuePicker 37, CopyButton 34, SubtaskProgress 34, LinkedText 33, TaskList 30, PersonName 30, SettingsSheet 28, Highlighted 28, TaskSheet 26, LinkedField 26, CompletedSection 25, CompletedList 23, PendingCount 20, AddTaskButton 20, CompletedToggle 17, LabelChip 16). Read as far as needed: `session.svelte.ts`, `powersync.svelte.ts`, `ui.svelte.ts` (Sheets), `push.svelte.ts`, `store.svelte.ts` (open, delete*), `shared/views.ts`, `shared/store.ts` (sectionTasks), `shared/subtasks.ts`, `ThemeSwitcher.svelte`, `TaskDetails.svelte` (Escape/delete paths).
Commit: ad9437e
Method: read every file in the slice in full; traced callers with grep; ran `bun run --cwd app-web check` once (0 errors, 0 warnings; working tree unchanged afterwards). Reproduced F1 by compiling a minimal Svelte 5.57.2 component with the repo's own compiler and driving it in headless Chromium and WebKit through playwright-core (`/tmp/procrastimate-thermo/07b/{Rename.svelte,build.ts,run.ts}`), and checked Svelte's `destroy_effect` order (DOM removed before listener teardown). Measured the sidebar and section count costs with scratch benches against the real `shared/views.ts` and `shared/store.ts` (`/tmp/procrastimate-thermo/07b/bench*.ts`). Grepped `index.css` tokens and classes against all of `app-web/src` and `shared` to look for dead rules.

## Verdict

The slice is in decent shape. The routes already share one `View` scaffold. Runes are mostly used correctly, svelte-check is clean, and `index.css` has almost no dead rules: every token and component class has a consumer. The one real bug is the inline edit pattern used in four places (`onblur` commits, `Escape` unmounts). In Chromium, Escape saves the edit it should cancel, and Enter saves twice. The fix also removes most of the duplication between the project, label, and section headers. Second, a task sheet whose task disappears from sync leaves `sheets.current` stuck on `task`. Nothing renders, but the FAB and the `Q` shortcut stay disabled.

## Findings (most important first)

### F1. Escape commits, and Enter double-commits, every inline rename and the add-section field in Chromium [bug] [CONFIRMED] [effort: S]

Four inputs share one shape: `onblur={(e) => commit(e.currentTarget.value)}`, Enter calls `commit`, and Escape sets the `renaming`/`addingSection` flag to false. The four are the project title at `routes/projects/[id]/+page.svelte:77-87`, the add-section field at `routes/projects/[id]/+page.svelte:144-154`, the label/place title at `routes/labels/[id]/+page.svelte:71-81`, and the section title at `lib/components/ProjectSection.svelte:46-56`. Flipping the flag unmounts the focused input. Chromium fires `blur` when a focused element is removed. Svelte's `destroy_effect` (`node_modules/svelte/src/internal/client/reactivity/effects.js:518-542`) removes the DOM before it runs the teardown that detaches listeners, so the `onblur` handler still runs and reads the edited value.

Reproduced with the repo's Svelte 5.57.2, a minimal copy of the pattern, the input filled with "Edited", then one key pressed:

```
chromium Escape [ [ "rename:Edited" ], "Edited" ]                 <- cancel saved the edit
chromium Enter  [ [ "rename:Edited", "rename:Edited" ], "Edited" ] <- two writes
webkit   Escape [ [], "Original" ]
webkit   Enter  [ [ "rename:Edited" ], "Edited" ]
```

So on desktop Chrome (Stefan's primary web client), typing a section name and pressing Escape creates the section. Renaming a project, label, or section and pressing Escape renames it. Every Enter-confirmed rename writes twice, which costs two local transactions and two upload ops. The Sidebar's add-project field (`Sidebar.svelte:120-134`) and ProjectPicker's new-project field (`ProjectPicker.svelte:86-105`) are safe by accident: both clear `name` before unmounting, so the second commit sees an empty string. No e2e covers Escape on these fields. `labels.e2e.ts`, `projects.e2e.ts`, and `sections.e2e.ts` only confirm with Enter, and pass because the second write is identical.

Remedy: one `InlineEdit.svelte` (about 25 lines) that commits at most once and lets Escape cancel. It replaces the four hand-rolled inputs, about 11 lines each, plus the `rename`/`addSection` helpers that only trim and reset a flag:

```svelte
<script lang="ts">
	let { value = '', label, class: cls, placeholder, oncommit, onclose }: {...} = $props();
	let settled = false;
	function finish(commit: boolean, text: string) {
		if (settled) return;
		settled = true;
		if (commit && text.trim() && text.trim() !== value) oncommit(text.trim());
		onclose();
	}
</script>
<input {value} aria-label={label} class={cls} {placeholder} {@attach (n) => n.focus()}
	onblur={(e) => finish(true, e.currentTarget.value)}
	onkeydown={(e) => { if (e.key === 'Enter') finish(true, e.currentTarget.value); if (e.key === 'Escape') finish(false, ''); }} />
```

Behavior is preserved: blur and Enter still commit, and Escape now cancels in every engine, which is what the code already intended. The `text !== value` guard also drops the no-op rename write when the name didn't change.

### F2. A task sheet whose task disappears leaves the app stuck in "a sheet is open" [bug] [PLAUSIBLE] [effort: S]

`+layout.svelte:35` derives `openTask = store.task(sheets.current.id)`, and `:177` renders `TaskSheet` only `{:else if openTask && sheets.current.kind === 'task'}`. When the open task is deleted on another device, or the user loses access to a shared space, sync removes it from the store. The sheet vanishes, but `sheets.current` stays `{ kind: 'task' }`. Local deletes are fine because `TaskDetails.remove` calls `leave()` and `sheets.close()` (`TaskDetails.svelte:109-115`). Everything gated on `kind === 'none'` stays off:

- the mobile FAB (`+layout.svelte:154`)
- the `q` shortcut (`:69`)
- toast placement (`Toasts.svelte:10`): toasts stay pinned to the top on phones as if a sheet were docked.

On a phone the user has no visible way out. Nothing is on screen to close, and only opening another sheet from the drawer resets the state. If the task comes back (the other device undoes the delete), its sheet pops open again unprompted. Traced end to end in code, not executed.

Remedy, in the layout next to `openTask`:

```ts
$effect(() => {
	if (sheets.current.kind === 'task' && store.loaded && !openTask) untrack(() => sheets.close());
});
```

Or make `Sheets` own it, so every consumer sees a consistent state. The `store.loaded` guard keeps a database reopen from closing the sheet. No visible behavior changes for a task that exists.

### F3. The public link page reports every failure as "This link no longer works" [robustness] [CONFIRMED] [effort: S]

`routes/s/[token]/+page.svelte:47-50` runs `api.shared.view(...).catch(() => null)` and maps `null` to `{ kind: 'gone' }`, which shows "This link no longer works. Its owner stopped sharing it, or it was copied wrong." The server signals a stopped or malformed link with `ORPCError('NOT_FOUND')` (`server/src/router.ts:163`, `server/src/sharing.ts:158,164`). Offline, a 5xx, a Worker cold-start timeout, or a contract/parse error all get the same "stopped sharing" message. That misleads the recipient, who is often a signed-out stranger. `sharing.e2e.ts:221` pins the NOT_FOUND case only.

Remedy: catch with `error instanceof ORPCError && error.code === 'NOT_FOUND' ? 'gone' : 'failed'`, and add a `failed` state ("Couldn't load this link" with a Retry button that reruns the fetch). This touches about 10 lines. The gone path stays unchanged.

### F4. Project, label, and section headers each hand-roll the same rename plus "actions popover with confirm-delete" state machine [simplification] [CONFIRMED] [effort: M]

Three near-identical blocks exist:

- `routes/projects/[id]/+page.svelte:74-128`: title snippet with rename input, share button, Popover whose trigger resets `confirmingDelete`, Rename item, Delete item, confirm pane with Cancel and Delete.
- `routes/labels/[id]/+page.svelte:68-147`: the same, plus a color radiogroup.
- `lib/components/ProjectSection.svelte:43-111`: the same, plus Move up/down.

Each carries its own `renaming`/`confirmingDelete` flags, a trigger that resets them, the confirm copy and the destructive button classes (`btn press bg-[var(--tone-overdue)] text-on-accent`), and the "This X no longer exists" fallback in the two routes. With F1's `InlineEdit` and an `EntityActions.svelte`, the three call sites shrink to their unique items. `EntityActions` takes `label`, `confirm: string` (the delete question), `ondelete`, and a `children` snippet for the extra menu items such as the color grid or move up/down, and owns the confirm toggle. Net: about 150 hand-rolled lines become about 50 shared lines plus about 15 per site. The confirm-delete flow then lives in one place, and F1-class bugs can't diverge between the copies. Behavior is identical: same items, same order, same labels. The e2e specs select by role and name, and those stay the same.

### F5. `DictationSwitcher` is a copy of `ThemeSwitcher` [simplification] [CONFIRMED] [effort: S]

`DictationSwitcher.svelte` (114 lines) and `ThemeSwitcher.svelte` (122 lines) are the same segmented radiogroup. A diff after renaming the identifiers leaves only the choice list, the labels, the icons, and `repeat(2|3, 1fr)` / `/ 2|3`. Both duplicate the full CSS block: thumb, segment, focus-visible, active scale, and the touch media query. Remedy: one `Segmented.svelte` generic over `T extends string` with `choices`, `value`, `onchange`, `label`, and an optional icon per option. It sets `--count` for the column count and thumb width. The two switchers become about 8-line call sites, or are inlined in `Settings.svelte`. That removes about 110 lines, with the same roles, keyboard handling, and visuals.

### F6. `View` builds the whole Markdown document on every render just to read its title [efficiency] [CONFIRMED] [effort: S]

`View.svelte:54` renders `label={`Copy ${markdown().title} as Markdown`}`. Calling `markdown()` in the template evaluates it eagerly and subscribes the View header to everything the document reads. On `/completed` that means every day's `completedHeading`. On a project it means `projectDocument(project, groups)`. On Inbox and No date it means fresh section arrays. All of that rebuilds on every store change or clock tick, although the document is only needed when the copy button is clicked (`CopyButton.svelte:21` already calls it lazily). The title is always known statically. It is the `title` string, or `project.name`/`label.name` for the two snippet titles.

Remedy: give `View` a `name: string` prop, required, used for both the default `<h1>` and the copy label, and keep `title?: Snippet` as an override. Then `markdown` is called only on click. The labels are unchanged (`sections.e2e.ts:54` pins `Copy Home as Markdown` on SectionHeading, which already passes `heading` directly).

### F7. Sidebar and section counts rescan and resort the full task list per row [efficiency] [CONFIRMED] [effort: S]

- `ProjectList.svelte:35` runs `{@const count = projectTasks(store.own.tasks, project.id).length}` for each project, and `Sidebar.svelte:40-44` runs `labelViewTasks` for each label. Each call does a full `filter`→`filter`→`toSorted` pass only to take `.length`. Sorting doesn't change the count.
- Measured with 2000 tasks, 25 projects, and 20 labels: 0.55 ms per recompute, against 0.03 ms for one counting pass. Every task write repeats it, and on phones twice while the drawer is open, because the layout mounts a second `Sidebar`.
- `ProjectSection.svelte:31` eagerly computes `removing = sectionTasks(store.tasks, section.id).length` for every section on every store change, only for the delete-confirm copy. `sectionTasks` calls `descendantsOf` per task, and that rebuilds `groupChildren` over all tasks each time (`shared/subtasks.ts:42-43`): 2.1 ms for 5 sections × 200 tasks at T=3000.

These are millisecond-scale, not user-visible today, but they grow as O(rows × T) on a list that only grows (completed tasks count toward T). Remedy: a single-pass `openCounts(tasks)` in `shared/views.ts` that returns `{ byProject, byLabel, byPlace }`, read by both sidebar lists. Compute `removing` inside the confirm pane, which is a natural fit once F4's `EntityActions` owns that pane. Cross-slice: `sectionTasks` should build `groupChildren` once rather than per task.

## Smaller notes

- **Dead prop.** `AddTaskButton.svelte:8` declares `label = 'Add task'`. No caller passes it (View, ProjectSection, and the project page all use the default), so it can go.
- **Primary button duplication.** `.btn-primary` in `index.css:302` exists, but the layout's "Reload" (`+layout.svelte:122`), `SignIn.svelte:67`, and `CompletedRangePicker.svelte:63` hand-roll `btn press bg-accent text-on-accent` without its rim and shadow, while QuickAdd, ShareSheet, RecurrencePicker, and places use `.btn-primary`. Unifying them is a small visual change, so it's a product call. Likewise the destructive `btn press bg-[var(--tone-overdue)] text-on-accent` appears three times (F4) and could be a `.btn-danger`. The dark-theme pair (`#1c0a06` on `#ff7477`) is not among the pairs `theme-contrast.test.ts` checks.
- **Raw colors.** `Checkbox.svelte:24,62` (`color: white`) and `CompletedRow.svelte:59` (`text-white`) use raw colors, against theming.md's "Components use only these tokens, never raw colors". `on-accent` is dark in dark mode, so it is not a drop-in replacement. If white-on-priority is intended in both themes, it needs its own token, such as `--on-tone`.
- **Repeated touch media query.** `index.css` opens `@media (max-width: 767px), (pointer: coarse)` twice in the same `@layer components` (`:415` and `:464`), and also restates it in `labels/[id]` `.swatch`, `DictationSwitcher`, and `ThemeSwitcher`. Merge the two in `index.css`. The `.press` transition list is also repeated verbatim in `.chip, .btn` (`:268-272`). Otherwise the stylesheet is tidy. Every token and class has a consumer (`--tone-later` and `--tone-*` are reached through `var(--tone-${dueTone(...)})`), and `app.html`'s pre-paint theme script matches theming.md.
- **Tap target.** SignIn's "Create an account" / "Already have an account" toggle (`SignIn.svelte:68`) is a bare 13 px text button with no `touch:` height or `hit-area`. It's the only sub-44 px target in the slice.
- **Inconsistent delete counts.** The project delete confirm says "and its N tasks" with `tasks.length`, which counts open top-level tasks only (`projects/[id]/+page.svelte:111`). `deleteProject` also removes completed tasks and subtasks. The section confirm counts all of them (`sectionTasks`). Product question: pick one meaning.
- **Duplicated place match.** `labels/[id]/+page.svelte:29` reimplements `placeTasks`' key match (`atPlace`) to feed `completedTasks`. A shared `labelMatches(label)` predicate used by both `labelViewTasks` and the completed slice would remove it.
- **Effect that could be a hook.** `+layout.svelte:104-107` uses `$effect(() => { void page.url.pathname; menuOpen = false; })`, which is `afterNavigate(() => (menuOpen = false))` in SvelteKit. `DuePicker.svelte:15` keeps `today` as a pure alias of `clock.today`.
- **Startup sequence.** The startup order is sound: the session is cached-first, sync waits for `confirmed` so a user switch clears the database first, and push and sync are torn down together. Cross-slice: `startSync` (`powersync.svelte.ts:136`) does `void store.open(userId).then(connect)`, so a rejected open is an unhandled rejection that never reaches `store.unreadable`.
- **Public page markup.** `s/[token]/+page.svelte:58-73` hand-rolls View's header and SectionHeading's markup, minus the copy buttons. Reusing them would add Copy as Markdown to the public page, which is a feature change and a product question.
- **localStorage key naming.** No date's key is `procrastimate.noDateOldestFirst`, while theme and session use `procrastimate-theme` and `procrastimate-user`.

## Test coverage observations

- No spec presses Escape on the project, label, or section rename, or on the add-section field (F1). A desktop Chromium e2e of "type, Escape, name unchanged" would have caught it.
- No spec covers the open task being deleted by another device while its sheet is open (F2). `sync.e2e.ts` has the two-device harness to write one.
- The public link spec covers only the stopped-link path, not a network or server failure (F3).
- Sidebar counts, the No date sort toggle persistence, and the completed range picker's swap of reversed custom dates have no direct assertions I could find in `e2e/`. They rely on `shared/views.test.ts` vectors for the underlying lists, which test behavior, not the UI wiring.
