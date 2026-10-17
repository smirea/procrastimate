# Labels

Labels let Stefan tag a task with any number of names that cross projects, such as `calls` or `waiting`. He types `@name` in quick add or the task title, with suggestions as he types, or picks labels in task details. Every label has one of twelve colors, picked from its name at first and changed from the label's actions. Rows show their labels as small chips in that color inline after the title, which wraps to two lines, and the sidebar's Labels section opens every task with a label.

## Sub-features

- `labels-type` adds existing labels by typing `@name` in quick add or the task details title, and leaves emails and handles such as `bob@site.com` or `@5pm` as text.
- `labels-autocomplete` suggests labels after `@`, ordered best match, then recently used, then alphabetical, and offers to create a missing one.
- `labels-chips` shows each task's labels as chips inline after its title, each in its label's color. The row shows at most two lines; a longer title ends in an ellipsis and the chips stay visible at the end of the second line.
- `labels-color` picks a label's color from its actions menu, and a new label starts with a color from its name. On iOS, the on-device model may then swap that color for one that fits the name better (iOS only).
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
- Web: use `Label actions` in a label view's header to pick its color, rename it, or delete it.
- Web: search a label's name and open it from the `Labels` group.
- iOS: type `@name` in quick add.
- iOS: open the Browse tab's Labels section, which appears once a label exists, and use `Label actions` in a label's toolbar to pick its color, rename it, or delete it.
- iOS: search a label's name in the field at the top of Browse and tap it in the `Labels` group.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with no labels.
- Unit proof for the matching rules: `bun test shared/name-search.test.ts shared/search.test.ts shared/quick-add.test.ts`.

- **Create and type.** In quick add, type `Call plumber @calls`. The `Labels` list opens above the field with only `Create label “calls”`. Press Enter, type `@waiting`, and press Tab. The field reads `Call plumber @calls @waiting ` with both phrases highlighted. Press Enter. Unit test: `every known label is assigned, case-insensitively and in any project` in `shared/quick-add.test.ts`.
- **Emails stay text.** In the same test, type `Email bob@site.com @wa`. The list shows `waiting` and `Create label “wa”`. Press Enter and save. The row `Email bob@site.com` keeps the email in its title and shows the `waiting` chip.
- **Order and keys.** In the same test, type `Ping @`. The list reads `calls`, `waiting`. Press Down to select `waiting`, then Escape; the list closes and quick add stays open.
- **Chips.** `Call plumber` shows chips `calls` and `waiting`, also after a reload.
- **Two lines.** Add a title long enough to fill three lines with `@home`, plus `Short task @home`. At 1280 and 393 px wide the long row is two lines tall, ends its title in an ellipsis, and shows `home` at the end of the second line; `Short task` is one line with `home` right after the title. Test: `a row shows two lines of title with its labels inline, and a long title gives way to the labels` in `e2e/task-row.e2e.ts`. iOS: launch a Debug build with `PROCRASTIMATE_DEMO=rows` (with `PROCRASTIMATE_SIGNED_IN=1 PROCRASTIMATE_RESET=1`) for the same rows in Inbox, and add `search type:home` for search results.
- **Label view.** With label `calls` and project `Home`, add `Fix sink @calls` in `Home` and `Call bank @calls` in Inbox. Choose `calls` in the sidebar's Labels section. The heading reads `calls`, and `calls tasks` lists `Fix sink` with `Home`, then `Call bank` with `Inbox`. Quick add there saves `Call dentist` into the list.
- **Color.** Add `Fix login crash @bug` and `Call plumber @calls @tom`, creating each label. The row chips `bug` (red), `calls` (blue), and `tom` (teal) carry `data-color` with those keys, and quick add's `Labels` chip leads with the first label's color before saving. Choose `calls` in the sidebar, then `Label actions`. The `Label color` radio group has `Blue` checked. Choose `Pink`; the menu stays open, `Pink` is checked, and the heading's tag and the row chip turn pink. After a reload, and on a second browser signed in to the same account, the `calls` chip still reads `data-color="pink"`. Check both themes and 393 px wide, where the 12 swatches fit the popover in two rows of six.
- **Rename and delete.** In the same test, with label `Errands` also present, rename `calls` to `errands`; the heading still reads `calls`, since names are unique ignoring case. Choose `Label actions`, `Rename`, and enter `phone`. The heading and the row chips read `phone`. Choose `Label actions`, `Delete label`, then `Delete`. The app returns to Inbox, `phone` is gone from the Labels section, and `Call bank` remains without chips.
- **Automated.** The label view across `Home` and Inbox, the rename onto `errands` that keeps `calls`, the rename to `phone`, and the delete that leaves `Call bank` without chips: `a label view lists its tasks across projects, and the label renames and deletes while its tasks stay` in `e2e/labels.e2e.ts`. An Inbox task with no date still names `Inbox` in a label view: `a label view names Inbox on an Inbox task that has no date` in the same spec.
- **Details picker.** Add `Buy milk @errands`, open it, and choose `Labels errands`. The `Labels` menu opens with focus in `Find or create a label`. Type `groceries` and press Enter; `groceries` is created and checked. Tap `errands` to uncheck it, and press Escape; the chip reads `Labels groceries`. Type ` @err` at the end of the title, click `errands`, and press Enter; the title reads `Buy milk` and the chip reads `Labels groceries, errands`.
- **Phone.** Tap `Quick add`, raise the keyboard, and type `Call plumber @calls`. The `Labels` list sits above the field, fully on screen. Tap `Create label “calls”`; the field keeps focus. Tap `Add task` and `Cancel`; the row shows `calls`. Open it, tap `Labels calls`, type `waiting` in the menu's field, and tap `Create label “waiting”`. The menu stays on screen. Close the sheet; the row shows `calls` and `waiting`. Open `waiting` from the drawer; it lists `Call plumber` with `Inbox`. Run this at 393 px.
- **Search.** Searching `call` lists the `calls` label and every task labeled `calls`; Enter on the label opens its view. On a phone, the same test then opens search from the drawer, types `cal`, and taps `calls`; the `calls` view lists `Call plumber`. Unit test for the matching: `a label name matches its tasks and the label itself` in `shared/search.test.ts`.
- **iOS color.** Create `bug`, `calls`, and `tom` from quick add's `Create label “…”` rows; the quick add chips and the No date rows show them red, blue, and teal. Open `calls` from Browse, tap `Label actions`, then `Color`, and tap `Pink`. The Browse tag and the screen's rows turn pink, and the `Color` submenu checks `Pink`. With Apple Intelligence on, a label like `mom` turns from the default lime to the model's pick within about a second. The simulator has no model, so labels keep their default there; a DEBUG launch with `PROCRASTIMATE_LABEL_COLOR=pink` makes every new label turn pink a second after it is created, which proves the path from quick add to the rows. The rule that a rename, recolor, or delete made meanwhile wins: `LabelColorSuggestionTests` in `app-ios/Tests/CoreTests`. A name the prompt lists that a hint also knows, such as `deep work` (indigo) or `creative work` (violet), starts in the prompt's color, so the model's pick doesn't change it: `LabelColorsTests` checks every listed name.
- **iOS color model eval.** `app-ios/Evals/LabelColorModel` is a macOS package, run like `Evals/RambleModel`, that asks the Mac's on-device model for each name in `cases.json` with `LabelColors.modelInstructions` and passes it when the color is one the case accepts: `bun run generate && cd app-ios/Evals/LabelColorModel && swift run -c release eval -v cases.json default model`. `default` scores `defaultLabelColor` as the baseline, and `-v` lists each miss. It needs Apple Intelligence on the Mac. Rerun it after changing the prompt or a macOS update.
- **iOS.** `@` suggests labels and offers `Create label “…”`, `@calls` adds the label while `ana@example.com` stays text, and rows show label chips. Browse lists `calls` with `2`, and its screen lists `Fix sink` with `Home`, then `Call bank` with `Inbox`; quick add there starts with the `calls` chip. `Label actions`, `Rename` onto `errands` while `Errands` exists keeps `calls`, and `phone` renames it and the row chips. `Delete label` confirms with `Delete phone?` and `Its tasks stay, without the label.`, goes back to Browse, and `Call bank` stays without chips. Searching `wait` and tapping `waiting` opens its screen with `Dentist`. An unknown `@phone` shows `Create @phone` in the chip row and creates the label only when tapped. The labels chip in task details opens a popover that creates and toggles labels while it stays open.

## Gotchas

- `@name` is highlighted only for an existing label. Create labels from the `@` create row, the `Create @name` chip, or the picker first. Enter on an unknown `@word` picks `Create label`, so it takes a second Enter to save.
- The suite pins the clock, so every task has the same creation time and recency never breaks ties in e2e. `bun test shared/name-search.test.ts` proves recency ordering.
- Picking a label in the details menu keeps the menu open. Close it with Escape or a tap outside.
- On a phone the picker's field does not take focus until tapped, so the keyboard stays down.
- Find row chips with `.label-chip` or `[data-label="<name>"]` inside the row; `data-color` names the palette key. They sit inside the title's two-line block, not a separate list.
- Light-mode tones are dark on purpose so chip text passes AA, so orange and amber, or teal and cyan, sit closer together in light mode than in dark.
