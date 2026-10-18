# iOS screens review

Scope: every file under `app-ios/Sources/App/Screens/` (49 files, 8,456 lines). The largest are Ramble/RambleDrawer.swift (660), QuickAdd/QuickAddSheet.swift (559), Details/LocationChip.swift (421), Details/TaskDetailsPage.swift (344), Lists/TaskRow.swift (333), Ramble/RambleSession.swift (314), Browse/BrowseScreen.swift (286), QuickAdd/SmartInput.swift (273), Sharing/ShareSheet.swift (254), Details/EventChip.swift (235), Lists/TaskListScreen.swift (225), Details/SubtaskList.swift (221), Settings/SettingsSheet.swift (220), QuickAdd/DueChip.swift (214), SignIn/SignInView.swift (203), Settings/AIAccounts.swift (203), Search/SearchResultRow.swift (200). I read the rest in full too: Sharing (SharedLinkSheet 194, PersonName 33, SpaceEnvironment 8), Details (TaskComments 162, ImageStrip 163, RepeatChip 160, ReminderChip 148, LabelsChip 126, TaskPeople 114, ImageViewer 74, TaskDetailsSheet 57, NewProject 31), Browse (ProjectScreen 161, NameActions 157, PlaceSheet 103, LabelScreen 71, PlaceScreen 69), Lists (CompletedRow 131, CompletedScreen 115, TaskActions 106, RowActions 101, InboxScreen 85, TitleFlow 75, ListEmptyState 16), QuickAdd (NameSuggestions 178, QuickAddSubtasks 124, EditorTints 85, QuickAddMenu 83), Search (SearchResults 73, Highlighted 28, SearchShortcuts 22), Settings/TabsSettings 99, Ramble (RambleWaveform 74, RambleModel 65).
Commit: ad9437e
Method: I read every screen file in full. I traced the calls into Core (`Store.swift` accessors, `TaskDetails.draft/commitTitle`, `Views.projectTasks/labelTasks/labelViewTasks`, `Ramble.newTask`, `NameSearch.lastUsed`, `Comments.markRead`) and the `RootView` presentation of quick add and Ramble. For the expected behavior I checked the web twins (`TaskDetails.svelte`, `QuickAdd.svelte`) and the decisions files (`ios.md` UI mapping, `ux-principles.md`, `visual-language.md`). I did not run `swift build`. `Package.swift` builds only `Core` and `CoreTests`, and the screens compile only through `App.xcodeproj`, so the build would prove nothing about this slice. I ran no simulator, as instructed. Every finding below comes from reading the code. Each CONFIRMED one has a full code path I traced; each PLAUSIBLE one depends on SwiftUI runtime behavior I could not run.

## Verdict

The screens work and mostly follow `ios.md`. Views call `Store` commands and Core rules, and there are no `ForEach` id disasters. Accessibility labels are thorough. Two things matter most. First, task details keeps its title in `@State` that never resyncs and commits it in `onDisappear`, so closing details can silently revert a rename made on another device. Second, per-row work grows with the total task count: each `TaskRow` makes four passes over `store.allTasks`, which is itself a fresh array concatenation each time, plus a pass over `allComments`, and Browse sorts every project's and label's task list only to count it. Beyond that, the chip and picker layer is six copies of one shell, and the shared `Chip` is a 32 pt tap target, which breaks the 44 pt rule. RambleDrawer and QuickAddSheet each mix a state machine, editing helpers, and shared components that other screens import.

## Findings (most important first)

### F1. Closing task details can revert a remote rename [bug] [CONFIRMED] [effort: S]

`Details/TaskDetailsPage.swift:26,34` seeds `@State title` from `task.title` once, in `init`. Nothing ever updates it when `task.title` changes: there is no `onChange(of: task.title)`, and the form only gets a fresh identity when `TaskDetailsSheet` changes `root`. `TaskDetailsPage.swift:172` then runs `.onDisappear { commitTitle() }` unconditionally. In Core, `TaskDetails.commitTitle` (`Core/TaskDetails.swift:87-103`) returns `.update` whenever `title != task.title`, with a patch carrying `title: draft.title`, where `draft.title` is the parsed stale title.

To reproduce: open "Buy milk" in details on the phone and don't touch the title. Rename the task to "Buy oat milk" on the web, or through a Siri intent, or on another device. Sync reloads the store, and the form re-renders with `task.title == "Buy oat milk"` while `title == "Buy milk"`. While the sheet stays open, the field shows the stale text, and the chips show `TaskDetails.draft` of the stale text. When the sheet closes, `onDisappear` → `commitTitle` → `.update(TaskPatch(title: "Buy milk", ...))`, and the other device's rename is overwritten with no sign that anything happened.

The web twin also seeds with `untrack`, but it commits only on blur (`TaskDetails.svelte:220`, `onblur={commitTitle}`), so a title nobody focused never commits. iOS added the unconditional disappear commit.

Fix: keep the title the user started from and resync while the field is not focused.

```swift
@State private var base: String   // the title editing started from, seeded with `title` in init

.onChange(of: task.title) {
    guard !titleFocused, title == base else { return }
    title = task.title
    base = task.title
}

// commitTitle(): guard !locked, title != base else { return }; after `.update`, set base = next
```

Or simply drop the `onDisappear` commit and rely on the `titleFocused` change, which already fires when the sheet dismisses while focused. Either way, typing and then closing still saves; only the commit of a title nobody edited goes away. No test pins the disappear commit, and `TaskDetailsTests` covers only the pure rules.

### F2. Changing a chip while the title still holds a typed phrase applies the phrase twice [bug] [PLAUSIBLE] [effort: S]

In details, the chips get draft values, and their callbacks write those draft values straight to the task. Examples: `ReminderChip(reminders: draft.reminders) { store.updateTask(task.id, TaskPatch(reminders: $0)) }` at `TaskDetailsPage.swift:90-96`, and `LabelsChip` at :100-103. `TaskDetails.draft` sets `draft.reminders = task.reminders + parsed.reminders` (`Core/TaskDetails.swift:78`).

To reproduce: type "remind me 30m before" into the title, then, while the editor is still focused, tap the Remind chip and add or remove any reminder. The patch saves `task.reminders + [30m]` plus the change. On blur, `commitTitle` computes `draft.reminders = task.reminders (now containing 30m) + parsed.reminders ([30m])` and writes the 30m reminder twice. The web avoids this because clicking a chip blurs the `<input>`, which runs `commitTitle` first. A SwiftUI `Button` tap does not resign the `UITextView`, so on iOS the uncommitted draft survives the chip pick. Opening a popover might resign it; I could not check that without the simulator, so this finding is PLAUSIBLE.

Fix: call `commitTitle()` at the start of every chip callback in `TaskDetailsForm`, which also matches what the web does by accident. The other option is to pass task values rather than draft values to the chips' writes. Either way, the chip edit then lands on top of the committed title, which is the web's order.

### F3. Each visible row does several full passes over all tasks on every store change [efficiency] [PLAUSIBLE] [effort: M]

`Store.allTasks` is a computed `snapshot.tasks + sharedData.flatMap(\.tasks)`, and `sharedData` sorts the space keys too (`Core/Store.swift:141-143`). So every access allocates an array of all tasks. In `Lists/TaskRow.swift`:

- `subtasks` (:129-131) runs `Subtasks.groupChildren(store.allTasks.filter { $0.parentId == task.id })`.
- It is reached through `pending` twice in `row` (:56-57) and through `progress` twice (`hasDetails` :141, `details` :169). That is four concatenations and four filters of N tasks per row per body evaluation, although the comment on :128 says "one pass".
- `commentBadge` (:134) does `allComments.filter` over a fresh concatenation of all comments (`Store.swift:521-523`), evaluated twice (:142, :182).
- `parent`, `project`, and `labels` are linear scans.
- `CompletedRow.progress` (`Lists/CompletedRow.swift:49-51`) does the same filter.

`Store` is one `@Observable` whose `snapshot` changes on every command and every sync reload, so every rendered row re-evaluates. Each keystroke in the notes field (`TaskDetailsPage.swift:111` writes per keystroke, like the web) re-renders the list rows under the sheet too.

For scale: 20 rendered rows over 2,000 tasks is about 120 allocations of a 2,000-element `TaskItem` array per change. `SubtaskList` (`Details/SubtaskList.swift:28`) adds a `groupChildren(store.allTasks)` over everything on each body evaluation, and its `drag` state changes on every `DragGesture.onChanged` frame. So a subtask drag recomputes the full grouping, plus four passes per subtask row, at display rate.

Fix: this one crosses into Core. Have `Store` keep `childrenByParent: [String: [TaskItem]]` and `commentBadges: [String: CommentBadge]`, both rebuilt when a snapshot is replaced (in `commit` and `reload`). Rows then read `store.children(of: task.id)` once into a local in `body`. Behavior stays the same because the values are identical; only where they are computed moves. The cheaper view-only step is to compute `subtasks` once at the top of `body` and pass it down, which cuts the cost to a quarter.

### F4. Browse sorts every project's and label's task list just to count it [efficiency] [CONFIRMED] [effort: S]

`Browse/BrowseScreen.swift:70` calls `Views.projectTasks(store.tasks, project.id, ...).count` for each project. :144 calls `Views.labelViewTasks(...).count` for each label, and :186-190 calls `inboxTasks`/`todayTasks` for each unpinned list. `Views.projectTasks` is `topLevel(tasks).filter{...}.stableSorted(by: compare(...))` (`Core/Views.swift:85-87`), and `labelTasks`/`placeTasks` likewise sort (:105-112). That is P+L full scans of N tasks, each followed by a sort with a comparator that computes `scheduledDue`, and the result is thrown away for `.count`. Browse stays alive in its tab, so this runs on every store change: with 30 projects, 30 labels, and 2,000 tasks, about 120k task visits plus 60 sorts per keystroke anywhere.

Fix: add a Core helper that counts without sorting, for example `Views.openCounts(tasks, in:) -> (projects: [String: Int], labels: [String: Int])` built in one pass with the same `topLevel`/`open` predicates, plus a vector or unit test that it agrees with `projectTasks(...).count`. The counts stay identical because sorting never changes a count. The web sidebar probably has the same shape (cross-slice).

### F5. The picker chips are six copies of one shell, and the shared `Chip` is a 32 pt tap target [simplification] [CONFIRMED] [effort: S]

`DueChip`, `ReminderChip`, `RepeatChip`, `LabelsChip`, `LocationChip`, and `EventChip` each repeat the same 15-20 lines:

- `@State open`
- `Button { open = true } label: { Chip(...) }.buttonStyle(.plain)`
- `.accessibilityLabel(...)`
- `.onChange(of: openTrigger) { open = true }`
- `.popover(isPresented:) { X.presentationCompactAdaptation(.popover) }`, or `.sheet` for Location and Event

They differ only in the chip's icon, text, and tones, the a11y label, and the presented content. RepeatChip also captures `opened = anchor` on open, and Location/Event start open under `PlacesDemo`.

`Chip` (`QuickAdd/QuickAddSheet.swift:385-408`) is `.frame(minHeight: 32)` with `.contentShape(.capsule)`. Every one of those chips, plus `PriorityChip` and `ProjectChip`, is therefore a 32 pt tall hit area, packed 6 pt apart. `ux-principles.md` ("Every tap target is at least 44 px … using an invisible hit area") and `visual-language.md` ("44 pt on iOS") require 44. Some controls already add the invisible area by hand: the `+` menu and the subtask chip (`.contentShape(.rect.inset(by: -6))`) and the `Create #name` chip (`.frame(minHeight: 44)`). The rest don't, so the rule is applied unevenly.

Fix: one generic shell gives the hit area a single home.

```swift
struct PickerChip<Content: View>: View {
    enum Presentation { case popover, sheet }
    let chip: Chip
    let label: String
    var openTrigger = 0
    var presentation = Presentation.popover
    var startsOpen = false
    var onOpen: () -> Void = {}
    @ViewBuilder let content: (_ close: @escaping () -> Void) -> Content
    // Button { onOpen(); open = true } label: { chip.frame(minHeight: 44).contentShape(.rect) } ...
}
```

Each chip becomes its `Chip(...)` arguments plus its popover, which cuts about 60 lines. Related duplicates fold in the same pass:

- The 30-in-44 circular "xmark" remove button, written out in `DueChip.swift:134-147` and `ReminderChip.swift:58-72`.
- Ramble's private `Token` (`RambleDrawer.swift:626-645`), a second `Chip` with a different font and fill.
- `ProjectMenu` (`TaskDetailsPage.swift:314-344`), which is `ProjectChip` (`QuickAddSheet.swift:491-517`) with another label: same `Menu`, same `PlaceMenuContent` binding, same `newProjectPrompt`.

Visible styling stays the same; only the hit area grows. That growth is the intended behavior per the docs.

### F6. Failed actions fail silently where the docs require a toast [robustness] [CONFIRMED] [effort: S]

`ux-principles.md`: "Errors from an action are toasts, not inline text." These paths drop the error entirely:

- `Details/LocationChip.swift:248-252`: `guard let response = try? await MKLocalSearch(...).start(), let item = response.mapItems.first else { return }`. The user taps an Apple Maps result, a spinner shows, then nothing happens, and the sheet stays as it was. Show `toasts.show("Couldn't find that place")`, which needs `Toasts` from the environment, and log an `ErrorReport`.
- `Details/ImageStrip.swift:59-61`: `if let data = try? await item.loadTransferable(type: Data.self)`. Pick 3 photos and one fails, for example an iCloud original that won't download: 2 attach and the third vanishes without a word. Count the failures and toast "Couldn't add 1 image".
- `SignIn/SignInView.swift:185-188`: the Google token exchange throws a bare `URLError(.badServerResponse)` and discards Google's JSON error body, so the `ErrorReport` detail that `ErrorText` shows in DEBUG says nothing useful. Put the status and body in the error.

### F7. A ramble in a shared project shows its project and labels as missing [bug] [CONFIRMED] [effort: S]

`RambleDrawer` parses against the space (`spaceProjects`/`spaceLabels`, :59-60, :538, :554). The settled entries therefore carry the shared space's project and label ids. `chips(_:)`, however, resolves them in the user's own space: `store.projects.first { $0.id == id }` and `store.labels.filter { ... }` (:432-433), and `Store.projects` and `Store.labels` are `snapshot` only (`Core/Store.swift:137-138`). So a ramble started from a shared project's screen shows neither the "#Project" token nor its label tokens on each row. The expanded editor uses `LabelsChip`/`ProjectChip`, which search every space, so the two views disagree.

`save()` also passes `labels: store.labels` to `Ramble.newTask` (:582, :585), which uses them in `Triggers.applyPickedLabels` to turn a saved-place label into a location. A shared space's saved place is therefore saved as a plain label instead.

Fix: use `spaceProjects`/`spaceLabels` in both places. Own-space rambles behave exactly as before.

### F8. Quick add rules that `ios.md` puts in Core live in the view [simplification] [CONFIRMED] [effort: S]

`ios.md` says "Quick add rules live in `Core`. `QuickAddDraft` holds … the text wins over a pick, a pick removes the phrase that set it". Yet `QuickAddForm` holds these rules as private view methods with no tests:

- `setLabels` (`QuickAddSheet.swift:309-319`): unchecking a typed label removes its `@name`, matched by `"@\(name)".lowercased() == token.text.lowercased()`, and a typed label stays the text's.
- `setRecurrence` (:293-300): a repeat that starts on another day moves the date.
- `setLocation`, plus the "event drops due and repeat" step in `submit` (:352-355).

It is the same code as `QuickAdd.svelte:110-183` (cross-slice: ideally ported from one place). Move them onto `QuickAddDraft` (`mutating func pickLabels(_:parsed:labels:)`, `pickRecurrence(_:start:due:)`) next to `clearTokens`/`removeTokens`, with unit tests in `QuickAddDraftTests`. The view keeps only the calls.

The same kind of leak, smaller:

- `LabelScreen.swift:25-30` reimplements `labelViewTasks`'s predicate inline for the completed list. Use a Core `Views.labelViewCompleted`.
- `ReminderChip.swift:79-80` builds the event-relative section title in the view beside `ReminderMenu.sectionTitle`.

### F9. RambleDrawer and QuickAddSheet mix a state machine, editing helpers, and shared components [simplification] [PLAUSIBLE] [effort: M]

`RambleDrawer.swift` (660 lines) mixes three things:

- Rendering.
- A capture state machine: `phase`, `generation` tokens, `liveParse` cancellation, `nextKey`, `start`/`stop`/`finish`/`settle`/`parseLive`, and session callbacks that close over the view struct (:492-575).
- Tree editing over `[RambleEntry]` (`find`/`update`/`remove`/`binding`, :459-490).

Moving the state machine and the editing into a `@MainActor @Observable final class RambleCapture` (held as `@State`) would leave the view at about 350 lines of layout. The generation-token logic would then sit in a type you can read in one screen. The drawer's behavior stays the same because the same statements just move.

`QuickAddSheet.swift` has two separate problems:

- `QuickAddSheet` is a one-line wrapper around a private `QuickAddForm` (:8-14). Rename `QuickAddForm` to `QuickAddSheet` and delete the wrapper.
- About 175 of its lines are app-wide components unrelated to quick add, which Details, Ramble, Browse, and Search import: `Chip`, `PriorityChip`, `Place`, `Store.placeName`, `PlaceMenuContent`, `ProjectChip`, `FlowLayout`, and `Priority.flag` (:385-559). Move them to a `Screens/Shared/Chips.swift`, or fold them into F5's shell. They also hold the only force unwrap in the chip layer: `UIImage(systemName:)!` (:556) on a constant symbol name, which is safe.

### F10. `@State` holding a class is rebuilt on every parent re-render [efficiency] [PLAUSIBLE] [effort: S]

`@State private var session = RambleSession()` (`RambleDrawer.swift:45`) and `@State private var search = PlaceSearch()` (`LocationChip.swift:70`) evaluate their initializers every time the parent rebuilds the view struct. SwiftUI keeps the first instance and throws the new one away, but each throwaway still allocates. For `PlaceSearch` that means a new `MKLocalSearchCompleter` with its delegate set, once per re-render of the sheet's presenter. `LocationChip` lives in the details page, and that page re-renders on every store change. The fix is `@State private var search: PlaceSearch?` filled in `.task`/`onAppear`, or creating them lazily. Each throwaway is cheap, but this is the documented SwiftUI pitfall, and the completer allocation is the kind of thing that turns up in Instruments.

## Smaller notes

- **Remote delete leaves a blank sheet.** `TaskDetailsPage` renders nothing when `store.task(taskID)` is nil (`TaskDetailsPage.swift:10-13`), and the toolbar with `Close` lives inside the form. A task deleted on another device while its details are open therefore leaves an empty sheet with no button; only the swipe-down gesture closes it. Call `navigation.leave(parentID)` when the task goes away, the same way the local delete does.
- **Sign-in feedback.** `ux-principles.md` says the Google button should read `Opening Google…` while busy, but `SignInView.swift:65` always reads "Sign in with Google". `busy` also doesn't disable the Google and Apple buttons, so a double tap starts two flows. Separately, the Google token exchange form-encodes with `.urlQueryAllowed` (:183), which leaves `+`, `&`, and `=` unescaped. Google's codes and the base64url verifier don't contain those today, so this works only by luck. Use a form-encoding character set.
- **`SmartInput` recomputes its suggestion match.** `SmartInput.match` is a computed property that runs `NameMatch.at` (three `sigilFragment`s plus a `lastUsed` pass over the space's tasks) three times per body evaluation: `if let match`, `.animation(value: match)`, and `.onChange(of: match?.fragment)`. Compute it once with `let match = match` at the top of `body`. Separately, `EditorTints.focusedTextView()` walks every key window's whole view tree recursively, twice per keystroke (immediately and after 150 ms). That is fine today; cache the found `UITextView` weakly if profiling ever points here.
- **`SearchResults` row index lookup.** `SearchResults.swift:22` computes `rows.firstIndex(of: row) == active` for each row, an O(R²) deep `Equatable` comparison of `TaskHit`s (R ≤ 55). Use `ForEach(Array(section.rows.enumerated()))` with a running offset instead.
- **`PlaceSheet` force unwrap.** `PlaceSheet.Mode.edit(Label)` force unwraps `Triggers.placeLocation(label, .arrive)!` (`PlaceSheet.swift:32`). Make the case `.edit(Label, SavedPlace)` so that a label which is not a place cannot be passed.
- **Ramble saves notes as a second commit.** `RambleDrawer.save()` adds each task and then issues a second `updateTask` commit for its notes (:583, :586), because `NewTask` has no `notes` field. Each saved task with notes therefore costs two row batches. That is harmless but noisy; worth folding in if `NewTask` ever gains `notes` (shared schema, cross-slice).
- **`Picks` re-lists the draft's fields.** `Picks` in `TaskDetailsPage.swift:288-310` re-lists `TaskDetails.Draft`'s fields plus `event`. A `Draft(task)` comparison, with `event` added to `Draft`, would remove the struct.
- **Duplicated row detail rendering.** `TaskRow` and `CompletedRow` each write out their own "details" HStack: parent, project, and progress. `CompletedRow` shows `project?.name ?? "Inbox"` where `TaskRow` shows `store.placeName` with the section, a small inconsistency. `QuickAddSubtasks.row` and `RambleDrawer.chips` are two more renderers of "a draft task's attributes" with different icon and label choices.
- **`TaskPeople` uses its own calendar.** `ActivityRow.time` builds its own Gregorian `Calendar` per row (`TaskPeople.swift:109-110`) instead of using `clock.calendar`, which is the one place in the slice that sidesteps the injected clock rule.
- **Robust as written.** `RambleSession` handles its races carefully (epoch tokens, `userStop` checks after each await, an idempotent `finish`); I found no bug there. `Comments.markRead` is idempotent, so `TaskComments`' `onChange(initial: true)` does not write on every open.

## Test coverage observations

- There is no UI-test target. Every finding above sits in view code that no test reaches: the disappear commit (F1), the chip-before-commit order (F2), the space lookups in Ramble (F7), and quick add's label-unpick rules (F8). Moving F8 into `QuickAddDraft` makes it unit-testable. F1 and F2 can be pinned in `TaskDetailsTests` as a rule ("commit only when the title differs from the title editing started from"), if the base-title tracking moves into `TaskDetails`.
- `TaskDetailsTests` tests `draft`/`commitTitle` as pure functions against literal values, which is good. Nothing tests the `task.reminders + parsed.reminders` duplicate when the task already holds the typed reminder (F2's state). One test with `task.reminders == [30m]` and a title typing `remind me 30m before` would show whether that duplicate is intended.
- `BrowseTests` covers `labelsByName` and the prompts. If F4 adds a count helper, it needs one test asserting it equals `projectTasks(...).count` and `labelViewTasks(...).count` across subtasks, completed tasks, and saved places.
