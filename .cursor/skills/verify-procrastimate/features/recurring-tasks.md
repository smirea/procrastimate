# Recurring tasks

Recurring tasks let Stefan keep a task that comes back, such as a daily standup or a weekly review. He types a repeat like `every weekday` or picks one in task details. Checking the task off moves it, with its reminders, to the next occurrence instead of closing it.

## Sub-features

- `recurring-nl` parses repeats typed into quick add or the task title, including weekday lists such as `gym mon wed fri 7am` and `tue/thu`. [Add a task](./add-task.md) owns the phrase list.
- `recurring-picker` sets a preset, a custom interval, a weekday set, or `Don’t repeat` from the repeat chip in task details.
- `recurring-display` marks a recurring row with a repeat icon named after the repeat, such as `Repeats every Mon, Wed, Fri`.
- `recurring-complete` moves a completed recurring task to its next occurrence, with undo.
- `recurring-reminders` moves the task's reminders with it, so they fire for the next occurrence.

## How to get to it (user POV)

- Web: type a repeat such as `every mon`, `weekdays`, or `mon wed fri 7am` in quick add or the task details title.
- Web: open a task and choose the repeat chip, labeled `Repeat` or with the current repeat. The weekday toggles sit under the presets.
- Web: check off a recurring task from any list or with `Complete` in task details.
- iOS: Planned: not built yet.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for the web steps: `bun run test:e2e -- e2e/recurring.e2e.ts`.

- **Complete moves it.** Add `Standup every weekday 9am remind me 10m before`. The row reads `Tomorrow 9am` and has a `Repeats every weekday` icon. Check it off. The toast reads `Completed “Standup”, next due Friday 9am`, the row stays with `Friday 9am`, and its checkbox is unchecked again. Undo; the row reads `Tomorrow 9am`. Test: `completing a recurring task moves it and its reminder to the next occurrence`.
- **Reminder follows.** Check it off again, set the clock to Friday 8:51, and reload. A `Reminder: Standup` toast appears and the row reads `Today 9am`. Same test.
- **Due time notifies at each occurrence.** Add `Call mom every day 10:30am`; the row reads `Today 10:30am`. Check it off; it reads `Tomorrow 10:30am`. Set the clock to 10:31 today and reload; no `Reminder: Call mom` toast shows. Set it to 10:31 tomorrow and reload; the toast shows. Check it off and repeat a day later; the toast shows again. Test: `a repeating task notifies at each next occurrence’s due time with no reminder set`.
- **Several weekdays.** In quick add, type `Gym mon wed fri 7am`. The `Timing preview` reads `Fri Oct 16 at 7:00 AM · Repeats every Mon, Wed, Fri · Notifies at 7:00 AM`, and the repeat chip reads `Every Mon, Wed, Fri`. Press Enter. The row reads `Friday 7am` and has a `Repeats every Mon, Wed, Fri` icon. Check it off. The toast reads `Completed “Gym”, next due Monday 7am` and the row reads `Monday 7am`. Set the clock to Monday 7:01 and reload. A `Reminder: Gym` toast shows. Test: `a weekday list with a time repeats on each listed day and notifies at each`.
- **Prose stays text.** Add `Discuss mon wed plan` and `Yoga tue/thu`. The first row reads exactly `Discuss mon wed plan` and shows no date. `Yoga` reads `Tomorrow` with a `Repeats every Tue, Thu` icon. Test: `a weekday list in prose stays text while a slashed list repeats`.
- **Weekday picker.** Add `Water plants`, open it, and choose `Set repeat`. Seven weekday toggles, Monday first, sit under the presets, and none is pressed. Choose `Mon`. The chip reads `Every Mon` and the date chip reads `Monday`. Choose `Fri`. The menu stays open, `Mon` and `Fri` are pressed, the chip reads `Every Mon, Fri`, and the date chip reads `Friday`, the first listed day on or after today. Reload and open the task; both survive. Turn `Mon` off. The chip reads `Every Fri` and the `Fri` toggle is disabled. Test: `the repeat menu toggles weekdays and keeps the last one on`.
- **Picker.** Add `Water plants` and open it. Choose `Set repeat`, then `Every Wed`; the chip reads `Every Wed` and the date chip reads `Today`. Open the chip, enter `3` and `days` in the custom row, and choose `Set`; the chip reads `Every 3 days`, and it survives a reload. Test: `task details set, change, and clear a repeat`. The suite saves `app-web/test-results/recurrence-details.png`.
- **Typed in the title.** Replace the title with `Water plants every mon` and press Enter. The chip reads `Every Mon` and the date chip reads `Monday`. Same test.
- **Clear.** Choose `Don’t repeat`; the chip reads `Repeat`. Set `Every day`, then pick `No date` from the date chip; the repeat is cleared too. Same test.
- **Phone.** Add `Water plants every 2d`. The row reads `Today` with a `Repeats every 2 days` icon. Tap it, tap the `Every 2 days` chip; the `Repeat` menu opens fully on screen. Tap `Every weekday`; the chip reads `Every weekday`. Close the sheet and tap the checkbox; the toast ends `next due Tomorrow` and the row reads `Tomorrow`. Test: `task details set a repeat by touch and completing rolls the task forward` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/recurrence-menu.png` and `recurrence-details.png`.
- **Phone weekdays.** Add `Yoga tue/thu 6pm`. The row reads `Tomorrow 6pm` with a `Repeats every Tue, Thu` icon. Tap it, then tap the `Every Tue, Thu` chip. All seven weekday toggles are 44 px targets fully on screen. Tap `Sat`. The chip reads `Every Tue, Thu, Sat`. Tap the chip to close the menu, close the sheet, and tap the checkbox. The toast ends `next due Saturday 6pm` and the row reads `Saturday 6pm`. Test: `a slashed weekday list repeats and the repeat menu adds a day by touch` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/recurrence-weekdays.png`.
- **iOS.** Planned: complete a recurring task in the simulator. It moves to its next date.

## Gotchas

- A recurring task never shows up as completed. It is one task whose date moves. Assert the new date, not a missing row.
- The next date is the first occurrence after today, so completing an overdue daily task lands on tomorrow, not the day after the old due date.
- Setting a repeat on an undated task dates it today, and removing the date removes the repeat.
- A reminder whose new time passes while the app is closed fires on the next load. Change the clock and reload rather than waiting 15 seconds.
- The weekday toggles show one letter and are named `Mon` to `Sun`. Match them by exact name, because `Mon` also matches `Every month`.
- Toggles align from the due date the menu opened with, so toggle order never changes the result.
- The `Every <weekday>` preset shows its check mark only for a plain weekly repeat, not for a weekday set of one day.
- On a phone the repeat menu opens above the chip and covers the sheet's `Close` button. Tap the chip again to close the menu first.
