# Add a task

Add a task lets Stefan capture a task in one motion from anywhere in the app, with an optional due date, and see it land in the right list at once.

## Sub-features

- `add-open` opens quick add from each entry point.
- `add-save` saves a task with a title and lands it in the current list.
- `add-due` parses a due date typed into the title, such as `tomorrow` or `fri`.
- `add-cancel` discards an unsaved draft.
- `add-repeat` keeps quick add open after save for the next task.

## How to get to it (user POV)

- Web: choose the add button in any task list.
- Web: press `q` while focus is outside a text field.
- iOS: tap the add button in any task list.

## Driving it with control-ui and simctl

Preconditions:

- The baseline state, with an empty Inbox.

- **Open quick add.** Planned: press `q` on the web Inbox. Quick add appears with focus in the title field, with no delay.
- **Save.** Planned: type `Buy milk` and press Enter. `Buy milk` appears at once in Inbox and the field clears for the next task.
- **Due date.** Planned: add `Call mom tomorrow`. The task title reads `Call mom` and shows tomorrow's date.
- **Cancel.** Planned: open quick add, type `Discard me`, and press Escape. Inbox has no `Discard me`.
- **iOS entry.** Planned: tap the add button in the simulator and save `iOS task`. It appears in Inbox.
- **Proof.** Planned: reload the web client. `Buy milk` and `Call mom` are still in Inbox. Capture a snapshot and screenshot.

## Gotchas

- Pressing `q` inside a text field types the letter instead of opening quick add.
- Date words parse relative to the device clock and time zone. Assert the date the app shows, not one you computed.
- A task that appears before a reload proves only local state. Reload or relaunch for persistence.
