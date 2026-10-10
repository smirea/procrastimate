# Add a task

Add a task lets Stefan capture a task in one motion from anywhere in the app. Recognized phrases for due date, priority, reminders, project, and labels are highlighted inline as he types, removed from the title, and applied to the task, which lands in the right list at once.

## Sub-features

- `add-open` opens quick add from each entry point.
- `add-save` saves a task with a title and lands it in the current list.
- `add-due` parses a due date typed into the title, such as `tomorrow` or `fri 5pm`.
- `add-shorthand` parses compact phrases such as `tom 5p`, `eow`, `2d`, `5m`, `1730`, `10/15`, and `the 15th`, and leaves names and ordinary words such as `Tom` and `sun hat` as text.
- `add-recurrence` parses a repeat such as `every mon`, `daily`, yearly `every march 2nd`, or a weekday list such as `mon wed fri 7am` or `tue/thu`, shows it as a chip, and stores it on the task. A weekday list in prose, such as `Discuss mon wed plan`, stays text.
- `add-highlight` highlights each parsed phrase inline and shows its value as a chip.
- `add-preview` spells out the resolved due date, repeat, due-time notification, and reminders in a panel above the field while the text carries them.
- `add-keep-text` un-parses a highlighted phrase so it stays in the title.
- `add-defaults` defaults the project inside a project view and the due date inside Today.
- `add-cancel` discards an unsaved draft.
- `add-repeat` keeps quick add open after save for the next task.

## How to get to it (user POV)

- Web: choose `Add task` in the sidebar or at the bottom of any task list.
- Web: press `q` while focus is outside a text field.
- Web on a phone: tap the floating `Quick add` button. Quick add opens as a bottom sheet docked above the on-screen keyboard.
- iOS: tap the add button in any task list.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The automated suite pins the browser clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for every web step: `bun run test:e2e -- e2e/quick-add.e2e.ts` from the repo root.

- **Open quick add.** Press `q` on the web Inbox. The `Quick add` dialog appears with focus in the `Task name` field. Test: `q opens quick add`.
- **Highlight and save.** Type `call mom tomorrow 5pm remind me 30m before p1`. `tomorrow 5pm`, `remind me 30m before`, and `p1` are highlighted, and the chips read `Tomorrow 5pm`, `P1`, and `30m before`. Press Enter. `call mom` appears in Inbox with `Tomorrow 5pm` and one reminder, and the field clears with focus kept. Test: `q opens quick add, parses the brief example inline, and saves it`.
- **Repeat.** Save `Buy milk`, then `Pay rent`. Both are in Inbox and quick add stays open. Test: `saving lands the task in Inbox and keeps quick add open`.
- **Due date.** Add `Call mom tomorrow`. The task title reads `Call mom` and shows `Tomorrow`. Test: `a due date typed into the title is removed from the title`.
- **Shorthands.** Type `Call Tom about the sun hat tom 5p r30m`. Only `tom 5p` and `r30m` are highlighted, and the chips read `Tomorrow 5pm` and `30m before`. Press Enter. `Call Tom about the sun hat` shows `Tomorrow 5pm`. Test: `shorthands parse inline while names and ordinary words stay text`.
- **Recurrence.** In the same test, type `Standup every mon 9:30a`. `every mon` and `9:30a` are highlighted, and the chips read `Every Mon` and `Monday 9:30am`. Save. `Standup` shows `Monday 9:30am`, also after a reload. Planned: the row and task details show the repeat, and completing the task moves it to the next Monday.
- **Keep as text.** Type `Read Monday Night Club`. `Monday` is highlighted. Choose `Keep as text` next to the date chip. The highlight disappears and the saved title is `Read Monday Night Club` with no date. Test: `keep as text un-parses a highlighted phrase`.
- **Defaults.** Open quick add from Today; the date chip reads `Today`. Open it inside project `Errands`; the project chip reads `Errands`. Tests: `adding from Today defaults the due date to today` in `e2e/views.e2e.ts` and `quick add inside a project defaults to that project` in `e2e/projects.e2e.ts`.
- **Cancel.** Open quick add, type `Discard me`, and press Escape. Inbox has no `Discard me`. Test: `Escape discards the draft`.
- **Timing preview.** Type `Standup`; no `Timing preview` appears. Add ` every mon 9am`; the `Timing preview` status above the field reads `Mon Oct 19 at 9:00 AM · Repeats every Mon · Notifies at 9:00 AM`. Add ` remind me 10m before`; it gains `Remind 10 min before (8:50 AM)`. Replace the text with `Call mom tomorrow 5pm remind me 30m before`; it reads `Tomorrow, Thu Oct 15 at 5:00 PM · Notifies at 5:00 PM · Remind 30 min before (4:30 PM)`. Replace it with `Call mom tomorrow`; it reads `Tomorrow, Thu Oct 15` with no `Notifies at`. Replace it with `Call mom`; the preview disappears. Test: `quick add previews the resolved timing above the input as you type` in `e2e/timing-preview.e2e.ts`. The suite saves `app-web/test-results/timing-preview.png` and `app-web/test-results/timing-preview-notifies.png`.
- **Phone preview.** Tap `Quick add`, raise the keyboard, and type `Standup every mon 9am remind me 10m before`. The preview sits above the field, fully on screen, with the same text. Test: `quick add previews timing above the input with the keyboard open` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/timing-preview.png`.
- **Phone.** Tap `Quick add`. The sheet spans the screen width and sits at the bottom with focus in `Task name`. Type `Call mom tomorrow 5pm remind me 30m before p1`; the same three phrases are highlighted and the chips read `Tomorrow 5pm`, `P1`, and `30m before`. When the visual viewport shrinks by 300 px, as it does when the iOS keyboard opens, the sheet moves up to stay above it. Tap `Add task`; the field clears. Tap `Cancel`. `Call mom` shows `Tomorrow 5pm`, one reminder, and a `P1` checkbox. Test: `quick add docks above the keyboard and parses a reminder and priority` in `bun run test:e2e -- e2e/mobile.e2e.ts`.
- **Phone shorthands.** Tap `Quick add` and type `Pay Tom back eow r1h`. `eow` and `r1h` are highlighted, and the chips read `Friday 5pm` and `1h before`. Tap `Add task`, then type `Water plants every day 9am`. The chips read `Every day` and `Tomorrow 9am`, because 9am has passed. Tap `Add task` and `Cancel`. `Pay Tom back` shows `Friday 5pm` and one reminder, and `Water plants` shows `Tomorrow 9am`. Test: `quick add parses shorthands and keeps a name as text` in `bun run test:e2e -- e2e/mobile.e2e.ts`.
- **iOS entry.** Planned: tap the add button in the simulator and save `iOS task`. It appears in Inbox.
- **Proof.** Reload the web client. `call mom` is still in Inbox with `Tomorrow 5pm`. The suite saves `app-web/test-results/quick-add-parsed.png` and the phone sheet as `app-web/test-results/mobile/quick-add.png`.

## Gotchas

- The timing preview shows only while the field has focus and hides while `#` suggestions are open. Read it by its `Timing preview` status name. The `·` separators exist only for screen readers.
- Pressing `q` inside a text field types the letter instead of opening quick add.
- Playwright cannot open a real on-screen keyboard. The phone test simulates one by overriding `visualViewport.height` and firing `resize`. Confirm keyboard docking on a real iPhone.
- Date words parse relative to the device clock and time zone. Assert the date the app shows, not one you computed. Run the suite with its pinned clock rather than the wall clock.
- `docs/decisions.md` lists every phrase, default, and guard. `bun test shared/quick-add.test.ts` proves each one with the clock pinned. Use those tests for a phrase-by-phrase check instead of the UI.
- A time with no day lands tomorrow once it has passed. At the pinned 10:00, `9am` reads `Tomorrow 9am`.
- A date, recurrence, priority, or project phrase that appears twice uses the last one. `Today task today` saves `Today task` due today.
- The highlight layer sits behind the input and is `aria-hidden`. Find tokens with the `[data-token="due"]`, `recurrence`, `priority`, `reminder`, `project`, and `label` selectors, and read values from the chips.
- A task that appears before a reload proves only local state. Reload or relaunch for persistence.
