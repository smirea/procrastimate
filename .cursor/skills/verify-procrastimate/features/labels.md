# Labels

Labels let Stefan tag a task with any number of names that cross projects, such as `calls` or `waiting`. He types `@name` in quick add or the task title, with suggestions as he types, or picks labels in task details. Rows show their labels as small chips inline after the title, which wraps to two lines, and the sidebar's Labels section opens every task with a label.

## Sub-features

- `labels-type` adds existing labels by typing `@name` in quick add or the task details title, and leaves emails and handles such as `bob@site.com` or `@5pm` as text.
- `labels-autocomplete` suggests labels after `@`, ordered best match, then recently used, then alphabetical, and offers to create a missing one.
- `labels-chips` shows each task's labels as chips inline after its title. The row shows at most two lines; a longer title ends in an ellipsis and the chips stay visible at the end of the second line.
- `labels-picker` toggles and creates labels from the `Labels` chip in task details.
- `labels-view` lists every open task with a label, across projects, from the sidebar's Labels section, and quick add there starts with that label.
- `labels-rename` renames a label.
- `labels-delete` deletes a label and keeps its tasks.
- `labels-search` finds tasks by label name in search, and a label result opens the label view.

## How to get to it (user POV)

- Web: type `@` in quick add or the task details title to open label suggestions above the field.
- Web: choose the `Labels` chip under the title in task details.
- Web: use the Labels section of the sidebar, which appears once a label exists.
- Web on a phone: tap `Open navigation` to reach the Labels section.
- Web: use `Label actions` in a label view's header to rename or delete it.
- Web: search a label's name and open it from the `Labels` group.
- iOS: type `@name` in quick add.
- iOS: open the Browse tab's Labels section, which appears once a label exists, and use `Label actions` in a label's toolbar to rename or delete it.
- iOS: search a label's name in the field at the top of Browse and tap it in the `Labels` group.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with no labels.
- Automated proof for every web step: `bun run test:e2e -- e2e/labels.e2e.ts`, `bun run test:e2e -- e2e/search.e2e.ts -g label`, and `bun run test:e2e -- e2e/mobile.e2e.ts -g labels`.

- **Create and type.** In quick add, type `Call plumber @calls`. The `Labels` list opens above the field with only `Create label “calls”`. Press Enter, type `@waiting`, and press Tab. The field reads `Call plumber @calls @waiting ` with both phrases highlighted. Press Enter. Test: `@ creates and suggests labels, and saved labels show as chips on the row`. The suite saves `app-web/test-results/label-autocomplete.png`.
- **Emails stay text.** In the same test, type `Email bob@site.com @wa`. The list shows `waiting` and `Create label “wa”`. Press Enter and save. The row `Email bob@site.com` keeps the email in its title and shows the `waiting` chip.
- **Order and keys.** In the same test, type `Ping @`. The list reads `calls`, `waiting`. Press Down to select `waiting`, then Escape; the list closes and quick add stays open.
- **Chips.** `Call plumber` shows chips `calls` and `waiting`, also after a reload. The suite saves `app-web/test-results/label-chips.png`.
- **Two lines.** Add a title long enough to fill three lines with `@home`, plus `Short task @home`. At 1280 and 393 px wide the long row is two lines tall, ends its title in an ellipsis, and shows `home` at the end of the second line; `Short task` is one line with `home` right after the title. Test: `a row shows two lines of title with its labels inline, and a long title gives way to the labels` in `e2e/task-row.e2e.ts`. iOS: launch a Debug build with `PROCRASTIMATE_DEMO=rows` (with `PROCRASTIMATE_SIGNED_IN=1 PROCRASTIMATE_RESET=1`) for the same rows in Inbox, and add `search type:home` for search results.
- **Label view.** With label `calls` and project `Home`, add `Fix sink @calls` in `Home` and `Call bank @calls` in Inbox. Choose `calls` in the sidebar's Labels section. The heading reads `calls`, and `calls tasks` lists `Fix sink` with `Home`, then `Call bank` with `Inbox`. Quick add there saves `Call dentist` into the list. Test: `the Labels section opens every task with a label across projects`. The suite saves `app-web/test-results/label-view.png`.
- **Rename and delete.** In the same test, with label `Errands` also present, rename `calls` to `errands`; the heading still reads `calls`, since names are unique ignoring case. Choose `Label actions`, `Rename`, and enter `phone`. The heading and the row chips read `phone`. Choose `Label actions`, `Delete label`, then `Delete`. The app returns to Inbox, `phone` is gone from the Labels section, and `Call bank` remains without chips.
- **Details picker.** Add `Buy milk @errands`, open it, and choose `Labels errands`. The `Labels` menu opens with focus in `Find or create a label`. Type `groceries` and press Enter; `groceries` is created and checked. Tap `errands` to uncheck it, and press Escape; the chip reads `Labels groceries`. Type ` @err` at the end of the title, click `errands`, and press Enter; the title reads `Buy milk` and the chip reads `Labels groceries, errands`. Test: `the details picker toggles and creates labels, and @ works in the title`. The suite saves `app-web/test-results/label-picker.png`.
- **Phone.** Tap `Quick add`, raise the keyboard, and type `Call plumber @calls`. The `Labels` list sits above the field, fully on screen. Tap `Create label “calls”`; the field keeps focus. Tap `Add task` and `Cancel`; the row shows `calls`. Open it, tap `Labels calls`, type `waiting` in the menu's field, and tap `Create label “waiting”`. The menu stays on screen. Close the sheet; the row shows `calls` and `waiting`. Open `waiting` from the drawer; it lists `Call plumber` with `Inbox`. Test: `@ suggests labels above the keyboard, rows show chips, and the drawer opens a label` in `e2e/mobile.e2e.ts`. The suite saves `label-autocomplete.png`, `label-chips.png`, `label-picker.png`, and `label-view.png` under `app-web/test-results/mobile/`.
- **Search.** Searching `call` lists the `calls` label and every task labeled `calls`; Enter on the label opens its view. On a phone, the same test then opens search from the drawer, types `cal`, and taps `calls`; the `calls` view lists `Call plumber`. Tests: `a label matches its tasks and opens the label view` in `e2e/search.e2e.ts`, and the phone test above.
- **iOS.** `@` suggests labels and offers `Create label “…”`, `@calls` adds the label while `ana@example.com` stays text, and rows show label chips. Tests: `QuickAddParityTests` (`test_labels_type`, `test_labels_autocomplete`) and `ViewsParityTests.test_labels_chips`, paired with `e2e/parity/quick-add.e2e.ts` and `e2e/parity/views.e2e.ts`. Run each pair with the iOS workflow (`xcodebuild test` on an iPhone 16 simulator) and `bun run test:e2e --project=parity`; both sides save `<parity-id>.png`. Browse lists `calls` with `2`, and its screen lists `Fix sink` with `Home`, then `Call bank` with `Inbox`; quick add there starts with the `calls` chip. `Label actions`, `Rename` onto `errands` while `Errands` exists keeps `calls`, and `phone` renames it and the row chips. `Delete label` confirms with `Delete phone?` and `Its tasks stay, without the label.`, goes back to Browse, and `Call bank` stays without chips. Searching `wait` and tapping `waiting` opens its screen with `Dentist`. Tests: `LabelsParityTests` (`test_labels_view`, `test_labels_rename`, `test_labels_delete`) with `e2e/parity/labels.e2e.ts`, and `SearchParityTests.test_labels_search` with `e2e/parity/search.e2e.ts`. An unknown `@phone` shows `Create @phone` in the chip row and creates the label only when tapped (`QuickAddParityTests.test_add_create`, paired with `quick-add › add-create`). The labels chip in task details opens a popover that creates and toggles labels while it stays open. Test: `DetailsParityTests.test_labels_picker`, paired with `labels-picker` in `e2e/parity/details.e2e.ts`.

## Gotchas

- `@name` is highlighted only for an existing label. Create labels from the `@` create row, the `Create @name` chip, or the picker first. Enter on an unknown `@word` picks `Create label`, so it takes a second Enter to save.
- The suite pins the clock, so every task has the same creation time and recency never breaks ties in e2e. `bun test shared/name-search.test.ts` proves recency ordering.
- Picking a label in the details menu keeps the menu open. Close it with Escape or a tap outside.
- On a phone the picker's field does not take focus until tapped, so the keyboard stays down.
- Find row chips with `.label-chip` or `[data-label="<name>"]` inside the row. They sit inside the title's two-line block, not a separate list.
