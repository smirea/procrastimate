# Edit a task

Edit a task lets Stefan open a task and change its title, notes, due date, or priority, or delete it, with each change saved as he makes it.

## Sub-features

- `edit-open` opens task details.
- `edit-fields` changes title, notes, due date, and priority.
- `edit-delete` deletes a task.

## How to get to it (user POV)

- Web: choose a task in any list.
- Web: press Enter with a task selected.
- iOS: tap a task in any list.

## Driving it with control-ui and simctl

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk`.

- **Open.** Planned: choose `Buy milk` on the web. Its details open with the title and empty notes.
- **Change fields.** Planned: rename it to `Buy oat milk`, add the note `2 cartons`, set the due date to today, and set the highest priority. The list row reflects each change as it is made.
- **Persist.** Planned: reload the web client and reopen the task. All four values are kept.
- **Delete.** Planned: delete `Buy oat milk`. It leaves Inbox and does not appear in any view.
- **iOS entry.** Planned: open a task in the simulator, change its title, and go back. The list shows the new title.

## Gotchas

- There is no save button by design. Assert the stored value after a reload, not the field contents.
- Setting a due date of today also moves the task into Today. Check both views.
