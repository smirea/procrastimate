# Edit a task

Edit a task lets Stefan open a task and change its title, notes, due date, priority, reminders, or project, postpone it, or delete it, with each change saved as he makes it. The title field parses natural language the same way quick add does.

## Sub-features

- `edit-open` opens task details.
- `edit-fields` changes title, notes, due date and time, and priority. The date chip opens the same due picker as quick add (`add-due-picker`).
- `edit-nl` applies phrases typed into the title, such as `fri 6pm !! remind me 1h before`.
- `edit-config-row` shows the timing, priority, project, and labels the title will apply in the chips below it before Enter or blur commits them.
- `edit-delete` deletes a task, with undo.
- `edit-floating` floats `Complete` (or `Reopen` once done) at the bottom left of task details and `Delete` at the bottom right. The body scrolls clear of them. The top left project chip shows its icon and name and truncates with an ellipsis. On iOS they hide while the keyboard is up.
- `edit-links` shows web URLs and Markdown `[label](url)` links in the title and notes as links in rows, subtask rows, search results, and task details until the field is focused. A link opens in a new tab (web) or Safari (iOS) without opening the task.
- `edit-postpone` moves a task to `Today` (overdue or undated only), `Tomorrow`, `This weekend` (the coming Saturday, `Next weekend` on a weekend day), or `Next week` (the coming Monday), skipping its current day, keeping its time, with a `Moved “X” to <day>` toast and `Undo`. Event tasks have no postpone.

## How to get to it (user POV)

- Web: choose a task in any list. The details sheet slides in from the right.
- Web on a phone: tap a task. The details sheet slides up from the bottom.
- Web: press Enter with a task selected. Planned: task selection by keyboard is not built yet.
- iOS: tap a task in any list. The details sheet slides up.
- Postpone on web: hover a row and choose the calendar-plus `Postpone <title>` button. On touch screens the button is always visible, so a phone taps it directly. A popover lists the options with their weekdays.
- Postpone on iOS: swipe a row left. A `Postpone “<title>”` dialog lists the options with their weekdays and `Pick a date…`, which opens task details. The row's context menu has a `Postpone` submenu and `Delete`.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk` through quick add.

- **Open.** Choose `Buy milk`. The `Task details` dialog opens with the title `Buy milk` and empty notes.
- **Change fields.** Rename it to `Buy oat milk` and press Enter, add the note `2 cartons`, pick `Today` from the date chip, and pick `Priority 1`. The list row shows the new title and note as they change.
- **Persist.** Reload and reopen the task. Notes read `2 cartons`, the date chip reads `Today`, and the priority chip reads `Priority 1`. The task is under Inbox's `Today` section.
- **Every field, automated.** Add `Buy milk` and open it. Rename it `Buy oat milk`, type the note `2 cartons` (the row shows it), pick Friday October 16 and `6pm` from `Set due date`, pick `Priority 1`, and in `Add labels` create `groceries` and `errands`, then uncheck `groceries`. After a reload the Inbox row reads `Friday 6pm` and `errands`, and the details keep every value. Test: `task details edit the title, notes, date, priority, and labels, and keep them after a reload` in `e2e/edit-task.e2e.ts`. The Labels menu opens with focus in `Find or create a label`, and Escape returns focus to the chip: `Labels in task details opens with focus in its search field and gives it back to the chip on Escape` in the same spec.
- **Date and time.** Open `Water plants` from `No date`, choose `Set due date`, pick Friday October 16 in the calendar, choose `Add time`, then `6pm`. The chip reads `Due Friday 6pm` and, after a reload, the Inbox row shows `6pm`. On an overdue task, `Add time` then a time moves it to that time's next occurrence, today or tomorrow.
- **Natural language.** Open `Water plants` and replace the title with `Water plants fri 6pm !! remind me 1h before`, then press Enter. The title becomes `Water plants`, the date chip reads `Friday 6pm`, priority is `Priority 2`, and the reminder chip reads `1 reminder`.
- **Timing in the title.** Open `Standup` and type ` fri 6pm` at the end of the title. `fri 6pm` is highlighted, nothing appears above the title, and the date chip already reads `Friday 6pm` while the list row keeps its old date. Press Enter; the row moves to Friday.
- **Delete.** Choose the floating `Delete` button (named `Delete task`). The task leaves every view and an `Undo` toast appears. Undo restores it.
- **Links.** Add `Read [the post](https://example.com/p1) tomorrow`. The row reads `Read the post` with `the post` as an accent link. Click it: a new tab opens `https://example.com/p1` and the details sheet stays closed. Open the task by its row; the title shows `the post` as a link until you click the title outside the link, which shows `Read [the post](https://example.com/p1)` for editing. Type the note `Slides at www.example.com/deck.`; the row's notes show `www.example.com/deck` linking to `https://www.example.com/deck`, without the period. Search `post`: the result's link label has `post` highlighted. On iOS the same steps work by tap, and a link tap opens Safari.
- **Postpone.** On Wednesday, October 14, add `Pay rent yesterday 9am`. Hover it and choose `Postpone Pay rent`; the options read `Today`, `Tomorrow`, `This weekend`, and `Next week`. Choose `Tomorrow`. It moves under `Tomorrow` at 9am and `Moved “Pay rent” to Tomorrow` shows with `Undo`, which puts it back under `Overdue`. On a task already due tomorrow, `Today` and `Tomorrow` are absent. No automated test covers it.
- **Phone.** Add `Water plants` and tap it. Replace the title with `Water plants fri 6pm !! remind me 1h before` and press return; the chips read `Friday 6pm`, `Priority 2`, and `1 reminder`. Type the note `The ferns too`. Tap the `Priority 2` chip; the `Priority` menu opens fully on screen. Tap `Priority 1`. Tap `Close`; the row shows the note. After a reload the chips still read `Friday 6pm` and `Priority 1`.
- **iOS.** Tap `Buy milk`; the details sheet shows its title, the `Set due date` and `Priority 4` chips, and `Notes`. Retitle it `Buy oat milk` and press return, type `2 cartons` into `Notes`, pick `Tomorrow` from the date chip and `Priority 1` from the flag menu; after a relaunch they are still set. `Water plants fri 6pm !! remind me 1h before` becomes `Water plants` with `Due Friday 6pm`, `Priority 2`, and `1 reminder`. Typing ` fri 6pm` after `Standup` highlights it and the chip reads `Due Friday 6pm` before return applies it. `Delete task` closes the sheet with `Deleted “Buy milk”` and `Undo`. A trailing swipe on a row opens the postpone dialog with the same options as the web, and the context menu still deletes. The reminders chip adds `30m before` and a custom `Tomorrow 9am` and removes one, the toolbar's `Project Inbox` menu moves the task to `Home`, and the labels popover creates `calls` and `errands` and toggles `calls` off while it stays open. Drive it with `bun run start:ios -t simulator`.

## Gotchas

- There is no save button by design. Assert the stored value after a reload, not the field contents.
- The title applies on Enter or when the field loses focus. Escape reverts the title and closes the sheet.
- Setting a due date moves the task out of No date into its day in Inbox. Check both views.
- The title, notes, comment, and `Add subtask` fields wrap and grow with long text on both clients; the title and subtask fields stop at eight lines and comments at about twelve, then scroll inside. Pasting a long block keeps the caret's line on screen, inside the field and in the details sheet. Test: `title, notes, and subtask fields grow with their text instead of cutting it off` in `e2e/inputs.e2e.ts` (Chromium); WebKit, which is where a paste used to hide the caret, needs a manual run.
