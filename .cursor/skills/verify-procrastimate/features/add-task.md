# Add a task

Add a task lets Stefan capture a task in one motion from anywhere in the app. Recognized phrases for due date, priority, reminders, project, and labels are highlighted inline as he types, removed from the title, and applied to the task, which lands in the right list at once.

## Sub-features

- `add-open` opens quick add from each entry point.
- `add-save` saves a task with a title and lands it in the current list.
- `add-due` parses a due date typed into the title, such as `tomorrow` or `fri 5pm`.
- `add-shorthand` parses compact phrases such as `tom 5p`, `eow`, `2d`, `5m`, `1730`, `10/15`, and `the 15th`, and leaves names and ordinary words such as `Tom` and `sun hat` as text.
- `add-recurrence` parses a repeat such as `every mon`, `daily`, yearly `every march 2nd`, or a weekday list such as `mon wed fri 7am` or `tue/thu`, shows it as a chip, and stores it on the task. A weekday list in prose, such as `Discuss mon wed plan`, stays text.
- `add-highlight` highlights each parsed phrase inline and shows its value as a chip.
- `add-config-row` spells out the resolved due date, repeat, and reminders in the configuration row below the field while the text carries them.
- `add-defaults` defaults the project inside a project view and the label inside a label view. On iOS the tab bar's `+` takes them from the project or label on screen.
- `add-cancel` discards an unsaved draft.
- `add-reveal` closes quick add after save and shows the task's list, scrolled to the new row, which flashes. The list is the open label or project when it holds the task, else the task's project, else Inbox for a dated task or No date for an undated one.
- `add-create` offers `Create #name` or `Create @name` in the chip row for an unknown project or label and creates it only when picked.
- `add-dock` attaches quick add to the keyboard on a phone and hides the add button while it is open.
- `add-subtasks` takes subtask lines under the title from the checklist chip, parses each like `Add subtask`, removes a line with its `×`, and saves them under the new task in order.
- `add-toast` moves a toast to the top of a phone screen while quick add is open, so it never covers the chips.

## How to get to it (user POV)

- Web: choose `Add task` in the sidebar or at the bottom of any task list.
- Web: press `q` while focus is outside a text field.
- Web on a phone: tap the floating `Quick add` button. Quick add opens as a bottom sheet docked above the on-screen keyboard.
- iOS: tap `Quick add`, the accent `+` circle beside the tab bar. It opens quick add without switching tabs. Lists have no inline `Add task` row and no floating button (see `docs/decisions/ios.md`).

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The automated suite pins the browser clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for every web step: `bun run test:e2e -- e2e/quick-add.e2e.ts` from the repo root.

- **Open quick add.** Press `q` on the web Inbox. The `Quick add` dialog appears with focus in the `Task name` field. Test: `q opens quick add`.
- **Highlight and save.** Type `call mom tomorrow 5pm remind me 30m before p1`. `tomorrow 5pm`, `remind me 30m before`, and `p1` are highlighted, the chips read `Tomorrow 5pm` and `30m before`, and the priority flag is filled red. Press Enter. Quick add closes and `call mom` flashes under Inbox's `Tomorrow` with `Tomorrow 5pm` and one reminder. Test: `q opens quick add, parses the brief example inline, and saves it`.
- **Reveal.** From Inbox, save `Buy milk`. Quick add closes, No date opens, and the `Buy milk` row flashes. Save `Pay rent tomorrow`; Inbox opens with it under `Tomorrow`. From a project, save `Fix sink`; the project stays open with the row flashing. On iOS a project task opens its project in Browse unless that project is already open.
- **Due date.** Add `Call mom tomorrow`. The task title reads `Call mom` and shows `Tomorrow`. Test: `a due date typed into the title is removed from the title`.
- **Shorthands.** Type `Call Tom about the sun hat tom 5p r30m`. Only `tom 5p` and `r30m` are highlighted, and the chips read `Tomorrow 5pm` and `30m before`. Press Enter. `Call Tom about the sun hat` shows `Tomorrow 5pm`. Test: `shorthands parse inline while names and ordinary words stay text`.
- **Recurrence.** In the same test, type `Standup every mon 9:30a`. `every mon` and `9:30a` are highlighted, and the chips read `Every Mon` and `Monday 9:30am`. Save. `Standup` shows `Monday 9:30am`, also after a reload. Planned: the row and task details show the repeat, and completing the task moves it to the next Monday.
- **Defaults.** Open quick add from Inbox; no date chip is set. Open it inside project `Errands`; the project chip reads `Errands`. Test: `quick add inside a project defaults to that project` in `e2e/projects.e2e.ts`.
- **Cancel.** Open quick add, type `Discard me`, and press Escape. Inbox has no `Discard me`. Test: `Escape discards the draft`.
- **Configuration row.** Type `Standup every mon 9am remind me 10m before`. The row below the field shows `Due Monday 9am`, `Every Mon`, and `10m before`, and nothing appears above the field. Tests: `the configuration row spells out parsed timing with no preview above the input` and, on a phone, `the quick add configuration row shows parsed timing above the keyboard`, which saves `app-web/test-results/mobile/quick-add-timing-row.png`.
- **Phone.** Tap `Quick add`. The sheet spans the screen width and sits at the bottom with focus in `Task name`. Type `Call mom tomorrow 5pm remind me 30m before p1`; the same three phrases are highlighted, the chips read `Tomorrow 5pm` and `30m before`, and the priority flag is filled red. When the visual viewport shrinks by 300 px, as it does when the iOS keyboard opens, the sheet moves up to stay above it. Tap `Add task`; quick add closes. `Call mom` shows `Tomorrow 5pm`, one reminder, and a `P1` checkbox. Test: `quick add docks above the keyboard and parses a reminder and priority` in `bun run test:e2e -- e2e/mobile.e2e.ts`.
- **Phone shorthands.** Tap `Quick add` and type `Pay Tom back eow r1h`. `eow` and `r1h` are highlighted, and the chips read `Friday 5pm` and `1h before`. Tap `Add task`; quick add closes. Tap `Quick add` again and type `Water plants every day 9am`. The chips read `Every day` and `Tomorrow 9am`, because 9am has passed. Tap `Add task`. `Pay Tom back` shows `Friday 5pm` and one reminder, and `Water plants` shows `Tomorrow 9am`. Test: `quick add parses shorthands and keeps a name as text` in `bun run test:e2e -- e2e/mobile.e2e.ts`.
- **iOS.** Tap `Quick add`, the accent `+` beside the tab bar, in the simulator; the glass card sits flush on the keyboard, the tab bar hides, the selected tab stays, and focus is in `Task name`. The DEBUG launch word `PROCRASTIMATE_DEMO=quickadd` opens it without a tap. The same phrases highlight on the rendered text while typing (`test_add_highlight` reads the DEBUG `Rendered highlights` element), the chips spell them out, `#` and `@` suggest and create projects and labels, Return saves, closes the card, and shows the task in its list with the row flashing, and `Cancel` discards the draft. A tap anywhere on the card, including just beside the mic glyph, never reaches the scrim, so it never closes quick add. Tests: `QuickAddParityTests` (`test_add_open`, `test_add_save`, `test_add_due`, `test_add_shorthand`, `test_add_recurrence`, `test_add_highlight`, `test_add_config_row`, `test_add_defaults`, `test_add_cancel`, `test_add_reveal`, `test_add_create`, `test_add_dock`, `test_reminders_nl`, `test_projects_assign`, `test_projects_autocomplete`, `test_labels_type`, `test_labels_autocomplete`), paired with `e2e/parity/quick-add.e2e.ts`. Run each pair with the iOS workflow (`xcodebuild test` on an iPhone 16 simulator) and `bun run test:e2e --project=parity`; both sides save `<parity-id>.png`. Inside a project the project chip reads `Project <name>`, and inside a label view the label's chip shows (`ProjectsParityTests.test_projects_open`, `LabelsParityTests.test_labels_view`). Planned: the hardware keyboard `q` shortcut.
- **Create from the chip row.** On a phone, type `Call @dentist now`; the chip row shows `Create @dentist`, and Enter saves the task with `@dentist` left in the title. Type `Buy milk #Personal @phone today`, tap `Create #Personal` and `Create @phone`; both phrases highlight. Save; the row under Inbox's `Today` section shows `Personal` and `phone`. Test: `add-create` in `e2e/parity/quick-add.e2e.ts`, paired with `QuickAddParityTests.test_add_create`.
- **Subtasks.** Type `Pack for trip tomorrow`, then click the checklist chip `Add subtask` beside the priority flag; the `Add subtask` field opens under the title with focus. Type `Passport today p1`, Enter, `Mistake`, Enter, `Charger every day`, Enter. The list reads `Passport` with `Today` and a red ring, `Mistake`, and `Charger` with `Today` and `Every day`, and the chip reads `Add subtask, 3 added`. Click `Remove Mistake`. Type `Socks` and press Enter in `Task name`. Quick add closes, Inbox opens scrolled to `Pack for trip`, which flashes and shows `0/3`, and its details list `Passport`, `Charger`, `Socks` in that order. Escape after adding a subtask saves nothing. Return on an empty `Add subtask` field saves the task. On iOS the same steps work with the `checklist` chip (`Add subtask`), the `Remove <title>` buttons, and Return; quick add closes and Inbox lists `Pack for trip, Tomorrow, 0 of 3 subtasks done` and its dated subtasks. No automated spec: the e2e suite is smoke only and there is no XCUITest target (see `docs/decisions/testing.md`), so drive it with Playwright and a throwaway XCUITest.
- **Docked, toast on top.** On a phone, quick add's bottom edge meets the viewport bottom (the keyboard on iOS) and `Quick add` is hidden. Save `Call mom tomorrow 5pm every mon r30m`, then open quick add again; the `Get notified…` toast sits at the top on one line, its `Turn on` button stays one line, and it covers neither the repeat chip nor `Add reminder`. Tests: `add-dock` and `add-toast` in `e2e/parity/quick-add.e2e.ts`, `QuickAddParityTests.test_add_dock`.
- **Proof.** Reload the web client. `call mom` is still in Inbox with `Tomorrow 5pm`. The suite saves `app-web/test-results/quick-add-parsed.png` and the phone sheet as `app-web/test-results/mobile/quick-add.png`.

## Gotchas

- Pressing `q` inside a text field types the letter instead of opening quick add.
- Playwright cannot open a real on-screen keyboard. The phone test simulates one by overriding `visualViewport.height` and firing `resize`. Confirm keyboard docking on a real iPhone.
- Date words parse relative to the device clock and time zone. Assert the date the app shows, not one you computed. Run the suite with its pinned clock rather than the wall clock.
- `docs/decisions/quick-add.md` lists every phrase, default, and guard. `bun test shared/quick-add.test.ts` proves each one with the clock pinned. Use those tests for a phrase-by-phrase check instead of the UI.
- A time with no day lands tomorrow once it has passed. At the pinned 10:00, `9am` reads `Tomorrow 9am`.
- A date, recurrence, priority, or project phrase that appears twice uses the last one. `Today task today` saves `Today task` due today.
- The highlight layer sits behind the input and is `aria-hidden`. Find tokens with the `[data-token="due"]`, `recurrence`, `priority`, `reminder`, `project`, and `label` selectors, and read values from the chips.
- A task that appears before a reload proves only local state. Reload or relaunch for persistence.
