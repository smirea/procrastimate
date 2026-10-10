# Labels

Labels let Stefan tag a task with any number of names that cross projects, such as `calls` or `waiting`. He types `@name` in quick add or the task title, with suggestions as he types, or picks labels in task details. Rows show their labels as small chips, and the sidebar's Labels section opens every task with a label.

## Sub-features

- `labels-type` adds existing labels by typing `@name` in quick add or the task details title, and leaves emails and handles such as `bob@site.com` or `@5pm` as text.
- `labels-autocomplete` suggests labels after `@`, ordered best match, then recently used, then alphabetical, and offers to create a missing one.
- `labels-keep-text` keeps a typed `@label` in the title from its chip in quick add.
- `labels-chips` shows each task's labels as chips on its row.
- `labels-picker` toggles and creates labels from the `Labels` chip in task details.
- `labels-view` lists every open task with a label, across projects, from the sidebar's Labels section, and quick add there starts with that label.
- `labels-rename` renames a label.
- `labels-delete` deletes a label and keeps its tasks.
- Planned: search matches label names.

## How to get to it (user POV)

- Web: type `@` in quick add or the task details title to open label suggestions above the field.
- Web: choose the `Labels` chip under the title in task details.
- Web: use the Labels section of the sidebar, which appears once a label exists.
- Web on a phone: tap `Open navigation` to reach the Labels section.
- Web: use `Label actions` in a label view's header to rename or delete it.
- iOS: Planned.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with no labels.
- Automated proof for every web step: `bun run test:e2e -- e2e/labels.e2e.ts` and `bun run test:e2e -- e2e/mobile.e2e.ts -g labels`.

- **Create and type.** In quick add, type `Call plumber @calls`. The `Labels` list opens above the field with only `Create label “calls”`. Press Enter, type `@waiting`, and press Tab. The field reads `Call plumber @calls @waiting ` with both phrases highlighted. Press Enter. Test: `@ creates and suggests labels, and saved labels show as chips on the row`. The suite saves `app-web/test-results/label-autocomplete.png`.
- **Emails stay text.** In the same test, type `Email bob@site.com @wa`. The list shows `waiting` and `Create label “wa”`. Press Enter and save. The row `Email bob@site.com` keeps the email in its title and shows the `waiting` chip.
- **Order and keys.** In the same test, type `Ping @`. The list reads `calls`, `waiting`. Press Down to select `waiting`, then Escape; the list closes and quick add stays open.
- **Chips.** `Call plumber` shows chips `calls` and `waiting`, also after a reload. The suite saves `app-web/test-results/label-chips.png`.
- **Keep as text.** With label `deep`, type `Read about @deep learning`. `@deep` is highlighted with a `deep` chip. Choose `Keep as text`. The highlight disappears and the saved row `Read about @deep learning` has no chips. Test: `keep as text leaves an @label in the title`.
- **Label view.** With label `calls` and project `Home`, add `Fix sink @calls` in `Home` and `Call bank @calls` in Inbox. Choose `calls` in the sidebar's Labels section. The heading reads `calls`, and `calls tasks` lists `Fix sink` with `Home`, then `Call bank` with `Inbox`. Quick add there saves `Call dentist` into the list. Test: `the Labels section opens every task with a label across projects`. The suite saves `app-web/test-results/label-view.png`.
- **Rename and delete.** In the same test, with label `Errands` also present, rename `calls` to `errands`; the heading still reads `calls`, since names are unique ignoring case. Choose `Label actions`, `Rename`, and enter `phone`. The heading and the row chips read `phone`. Choose `Label actions`, `Delete label`, then `Delete`. The app returns to Inbox, `phone` is gone from the Labels section, and `Call bank` remains without chips.
- **Details picker.** Add `Buy milk @errands`, open it, and choose `Labels errands`. The `Labels` menu opens with focus in `Find or create a label`. Type `groceries` and press Enter; `groceries` is created and checked. Tap `errands` to uncheck it, and press Escape; the chip reads `Labels groceries`. Type ` @err` at the end of the title, click `errands`, and press Enter; the title reads `Buy milk` and the chip reads `Labels groceries, errands`. Test: `the details picker toggles and creates labels, and @ works in the title`. The suite saves `app-web/test-results/label-picker.png`.
- **Phone.** Tap `Quick add`, raise the keyboard, and type `Call plumber @calls`. The `Labels` list sits above the field, fully on screen. Tap `Create label “calls”`; the field keeps focus. Tap `Add task` and `Cancel`; the row shows `calls`. Open it, tap `Labels calls`, type `waiting` in the menu's field, and tap `Create label “waiting”`. The menu stays on screen. Close the sheet; the row shows `calls` and `waiting`. Open `waiting` from the drawer; it lists `Call plumber` with `Inbox`. Test: `@ suggests labels above the keyboard, rows show chips, and the drawer opens a label` in `e2e/mobile.e2e.ts`. The suite saves `label-autocomplete.png`, `label-chips.png`, `label-picker.png`, and `label-view.png` under `app-web/test-results/mobile/`.
- **Search.** Planned: searching `calls` finds tasks labeled `calls`.
- **iOS.** Planned.

## Gotchas

- `@name` is highlighted only for an existing label. Create labels from the `@` create row or the picker first. Enter on an unknown `@word` picks `Create label`, so it takes a second Enter to save.
- The suite pins the clock, so every task has the same creation time and recency never breaks ties in e2e. `bun test shared/name-search.test.ts` proves recency ordering.
- Picking a label in the details menu keeps the menu open. Close it with Escape or a tap outside.
- On a phone the picker's field does not take focus until tapped, so the keyboard stays down.
- Find row chips with `.label-chip` or `[data-label="<name>"]` inside the row. They are text in the row's button, not a separate list.
