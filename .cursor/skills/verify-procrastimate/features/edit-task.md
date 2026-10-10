# Edit a task

Edit a task lets Stefan open a task and change its title, notes, due date, priority, reminders, or project, or delete it, with each change saved as he makes it. The title field parses natural language the same way quick add does.

## Sub-features

- `edit-open` opens task details.
- `edit-fields` changes title, notes, due date, and priority.
- `edit-nl` applies phrases typed into the title, such as `fri 6pm !! remind me 1h before`.
- `edit-delete` deletes a task, with undo.

## How to get to it (user POV)

- Web: choose a task in any list. The details sheet slides in from the right.
- Web on a phone: tap a task. The details sheet slides up from the bottom.
- Web: press Enter with a task selected. Planned: task selection by keyboard is not built yet.
- iOS: tap a task in any list.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk` through quick add.
- Automated proof for every web step: `bun run test:e2e -- e2e/tasks.e2e.ts`.

- **Open.** Choose `Buy milk`. The `Task details` dialog opens with the title `Buy milk` and empty notes. Test: `details edit fields as they change and persist across reload`.
- **Change fields.** Rename it to `Buy oat milk` and press Enter, add the note `2 cartons`, pick `Today` from the date chip, and pick `Priority 1`. The list row shows the new title and note as they change.
- **Persist.** Reload and reopen the task. Notes read `2 cartons`, the date chip reads `Today`, and the priority chip reads `Priority 1`. The task is in Today.
- **Natural language.** Open `Water plants` and replace the title with `Water plants fri 6pm !! remind me 1h before`, then press Enter. The title becomes `Water plants`, the date chip reads `Friday 6pm`, priority is `Priority 2`, and the reminder chip reads `1 reminder`. Test: `natural language in the details title updates the fields`.
- **Delete.** Choose `Delete task`. The task leaves every view and an `Undo` toast appears. Undo restores it. Test: `delete removes the task and undo brings it back`.
- **Phone.** Add `Water plants` and tap it. Replace the title with `Water plants fri 6pm !! remind me 1h before` and press return; the chips read `Friday 6pm`, `Priority 2`, and `1 reminder`. Type the note `The ferns too`. Tap the `Priority 2` chip; the `Priority` menu opens fully on screen. Tap `Priority 1`. Tap `Close`; the row shows the note. After a reload the chips still read `Friday 6pm` and `Priority 1`. Test: `task details open as a sheet and edit fields` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/task-details.png`.
- **iOS entry.** Planned: open a task in the simulator, change its title, and go back. The list shows the new title.

## Gotchas

- There is no save button by design. Assert the stored value after a reload, not the field contents.
- The title applies on Enter or when the field loses focus. Escape reverts the title and closes the sheet.
- Setting a due date of today also moves the task into Today. Check both views.
