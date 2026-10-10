# Add a task

Add a task lets Stefan capture a task in one motion from anywhere in the app. Recognized phrases for due date, priority, reminders, and project are highlighted inline as he types, removed from the title, and applied to the task, which lands in the right list at once.

## Sub-features

- `add-open` opens quick add from each entry point.
- `add-save` saves a task with a title and lands it in the current list.
- `add-due` parses a due date typed into the title, such as `tomorrow` or `fri 5pm`.
- `add-highlight` highlights each parsed phrase inline and shows its value as a chip.
- `add-keep-text` un-parses a highlighted phrase so it stays in the title.
- `add-defaults` defaults the project inside a project view and the due date inside Today.
- `add-cancel` discards an unsaved draft.
- `add-repeat` keeps quick add open after save for the next task.

## How to get to it (user POV)

- Web: choose `Add task` in the sidebar or at the bottom of any task list.
- Web: press `q` while focus is outside a text field.
- iOS: tap the add button in any task list.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The automated suite pins the browser clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for every web step: `bun run test:e2e -- e2e/quick-add.e2e.ts` from the repo root.

- **Open quick add.** Press `q` on the web Inbox. The `Quick add` dialog appears with focus in the `Task name` field. Test: `q opens quick add`.
- **Highlight and save.** Type `call mom tomorrow 5pm remind me 30m before p1`. `tomorrow 5pm`, `remind me 30m before`, and `p1` are highlighted, and the chips read `Tomorrow 5pm`, `P1`, and `30m before`. Press Enter. `call mom` appears in Inbox with `Tomorrow 5pm` and one reminder, and the field clears with focus kept. Test: `q opens quick add, parses the brief example inline, and saves it`.
- **Repeat.** Save `Buy milk`, then `Pay rent`. Both are in Inbox and quick add stays open. Test: `saving lands the task in Inbox and keeps quick add open`.
- **Due date.** Add `Call mom tomorrow`. The task title reads `Call mom` and shows `Tomorrow`. Test: `a due date typed into the title is removed from the title`.
- **Keep as text.** Type `Read Monday Night Club`. `Monday` is highlighted. Choose `Keep as text` next to the date chip. The highlight disappears and the saved title is `Read Monday Night Club` with no date. Test: `keep as text un-parses a highlighted phrase`.
- **Defaults.** Open quick add from Today; the date chip reads `Today`. Open it inside project `Errands`; the project chip reads `Errands`. Tests: `adding from Today defaults the due date to today` in `e2e/views.e2e.ts` and `quick add inside a project defaults to that project` in `e2e/projects.e2e.ts`.
- **Cancel.** Open quick add, type `Discard me`, and press Escape. Inbox has no `Discard me`. Test: `Escape discards the draft`.
- **iOS entry.** Planned: tap the add button in the simulator and save `iOS task`. It appears in Inbox.
- **Proof.** Reload the web client. `call mom` is still in Inbox with `Tomorrow 5pm`. The suite saves `app-web/test-results/quick-add-parsed.png`.

## Gotchas

- Pressing `q` inside a text field types the letter instead of opening quick add.
- Date words parse relative to the device clock and time zone. Assert the date the app shows, not one you computed. Run the suite with its pinned clock rather than the wall clock.
- A date, priority, or project phrase that appears twice uses the last one. `Today task today` saves `Today task` due today.
- The highlight layer sits behind the input and is `aria-hidden`. Find tokens with the `[data-token="due"]`, `priority`, `reminder`, and `project` selectors, and read values from the chips.
- A task that appears before a reload proves only local state. Reload or relaunch for persistence.
