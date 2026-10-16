# Recurring tasks

Recurring tasks let Stefan keep a task that comes back, such as a daily standup or a weekly review. He types a repeat like `every weekday` or picks one in task details. Checking the task off moves it, with its reminders, to the next occurrence instead of closing it.

## Sub-features

- `recurring-nl` parses repeats typed into quick add or the task title, including weekday lists such as `gym mon wed fri 7am` and `tue/thu`. [Add a task](./add-task.md) owns the phrase list.
- `recurring-month-day` keeps a monthly repeat typed with a day, such as `every 31st`, on that day, or on the last day of a shorter month, and reads `Every month on the 31st`.
- `recurring-month-weekday` keeps a monthly repeat on a weekday, such as `every last Friday`, on that weekday of each month, and reads `Every month on the last Fri`.
- `recurring-picker` sets a preset, a custom interval, a weekday set, or `Don’t repeat` from the repeat chip in task details.
- `recurring-display` marks a recurring row with a repeat icon named after the repeat, such as `Repeats every Mon, Wed, Fri`.
- `recurring-complete` moves a completed recurring task to its next occurrence, with undo.
- `recurring-reminders` moves the task's reminders with it, so they fire for the next occurrence.

## How to get to it (user POV)

- Web: type a repeat such as `every mon`, `weekdays`, or `mon wed fri 7am` in quick add or the task details title.
- Web: open a task and choose the repeat chip, labeled `Repeat` or with the current repeat. The weekday toggles sit at the top of the menu.
- Web: check off a recurring task from any list or with `Complete` in task details.
- iOS: type a repeat in quick add, or use the repeat chip in task details.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with an empty Inbox. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for the Complete, Reminder, day-of-the-month, and weekday-of-the-month steps: `bun run test:e2e -- e2e/recurring.e2e.ts`.

- **Complete moves it.** Add `Standup every weekday 9am remind me 10m before`. The row reads `Tomorrow 9am` and has a `Repeats every weekday` icon. Check it off. The toast reads `Completed “Standup”, next due Friday 9am`, the row stays with `Friday 9am`, and its checkbox is unchecked again. Undo; the row reads `Tomorrow 9am`. Test: `completing a recurring task moves it and its reminder to the next occurrence`.
- **Reminder follows.** Check it off again, set the clock to Friday 8:51, and reload. A `Reminder: Standup` toast appears and the row reads `9am` under `Today`. Same test.
- **Due time notifies at each occurrence.** Add `Call mom every day 10:30am`; the row reads `Today 10:30am`. Check it off; it reads `Tomorrow 10:30am`. Set the clock to 10:31 today and reload; no `Reminder: Call mom` toast shows. Set it to 10:31 tomorrow and reload; the toast shows. Check it off and repeat a day later; the toast shows again.
- **A day of the month.** Set the clock to January 20 2027. In quick add, type `Pay rent every 31st`. The repeat chip reads `Every month on the 31st`. Press Enter; the row has a `Repeats every month on the 31st` icon. Check it off; the toast names Feb 28. Check it off again; the toast names Mar 31, not Mar 28. Test: `a monthly repeat on the 31st lands on the last day of February and returns to the 31st`.
- **A weekday of the month.** Set the clock to October 14 2026. In quick add, type `Review budget every last Friday`. The repeat chip reads `Every month on the last Fri`. Press Enter; the row reads Oct 30 and has a `Repeats every month on the last Fri` icon. Check it off; the toast names Nov 27. Test: `a repeat on the last Friday of the month rolls to next month’s last Friday`.
- **Weekday of the month in the menu.** Add `Pay card oct 19`, open it, and choose `Set repeat`. The menu lists `Every month on the 3rd Mon` after `Every month`. Choose it; the chip reads `Every month on the 3rd Mon`. Open it again and set a custom `2` months; the chip reads `Every 2 months on the 3rd Mon`. Test: `the repeat menu offers the due date’s weekday of the month`.
- **Several weekdays.** In quick add, type `Gym mon wed fri 7am`. The chips under the input read `Every Mon, Wed, Fri` and `Friday 7am`. Press Enter. The row reads `Friday 7am` and has a `Repeats every Mon, Wed, Fri` icon. Open it; the repeat chip in task details reads `Every Mon, Wed, Fri`. Close it and check it off. The toast reads `Completed “Gym”, next due Monday 7am` and the row reads `Monday 7am`. Set the clock to Monday 7:01 and reload. A `Reminder: Gym` toast shows.
- **Prose stays text.** Add `Discuss mon wed plan` and `Yoga tue/thu`. The first row reads exactly `Discuss mon wed plan` and shows no date. `Yoga` reads `Tomorrow` with a `Repeats every Tue, Thu` icon.
- **Weekday picker.** Add `Water plants`, open it, and choose `Set repeat`. Seven weekday toggles, Monday first, sit at the top of the menu, and none is pressed. Choose `Mon`. The chip reads `Every Mon` and the date chip reads `Monday`. Choose `Fri`. The menu stays open, `Mon` and `Fri` are pressed, the chip reads `Every Mon, Fri`, and the date chip reads `Friday`, the first listed day on or after today. Reload and open the task; both survive. Turn `Mon` off. The chip reads `Every Fri`, the `Fri` toggle is disabled, and the `Every Fri` preset shows its check mark, because a one-day set is stored as a plain weekly repeat.
- **Picker.** Add `Water plants` and open it. Choose `Set repeat`, then `Every Wed`; the chip reads `Every Wed` and the date chip reads `Today`. Open the chip, enter `3` and `days` in the custom row, and choose `Set`; the chip reads `Every 3 days`, and it survives a reload.
- **Typed in the title.** Replace the title with `Water plants every mon` and press Enter. The chip reads `Every Mon` and the date chip reads `Monday`. Same test.
- **Clear.** Choose `Don’t repeat`; the chip reads `Repeat`. Set `Every day`, then pick `No date` from the date chip; the repeat is cleared too. Same test.
- **Phone.** At 393 px, add `Water plants every 2d`. The row reads `Today` with a `Repeats every 2 days` icon. Tap it, tap the `Every 2 days` chip; the `Repeat` menu opens fully on screen. Tap `Every weekday`; the chip reads `Every weekday`. Close the sheet and tap the checkbox; the toast ends `next due Tomorrow` and the row reads `Tomorrow`.
- **Phone weekdays.** At 393 px, add `Yoga tue/thu 6pm`. The row reads `Tomorrow 6pm` with a `Repeats every Tue, Thu` icon. Tap it, then tap the `Every Tue, Thu` chip. All seven weekday toggles are 44 px targets fully on screen. Tap `Sat`. The chip reads `Every Tue, Thu, Sat`. The menu sits below the sheet's header. Tap `Close` while the menu is open; the sheet closes. Tap the checkbox. The toast ends `next due Saturday 6pm` and the row reads `Saturday 6pm`.
- **Phone completion.** At 393 px, quick add `Water plants every day 9am`; the chips read `Every day` and `Due Tomorrow 9am`. Tap `Add task`, then the row's checkbox. The toast reads `Completed “Water plants”, next due Friday 9am` and the one row reads `Friday 9am`. Test: `a repeating task added by touch rolls to its next date when checked off` in `e2e/phone.e2e.ts`.
- **iOS.** In the simulator (`bun run start:ios -t simulator`), a repeating row shows the repeat icon named after it, such as `Repeats every Mon`, and completing it moves it to its next date. After completing `Standup every day 10:30am r10m`, its reminder fires at the next occurrence: relaunching on Thursday at 10:21 shows `Reminder: Standup`. The repeat chip in task details lists `Every day`, `Every weekday`, `Every Fri`, `Every month`, and `Every year`, toggles `Mon` and `Wed` onto `Every Fri` while the popover stays open (`Repeats every Mon, Wed, Fri`), sets a custom `3` days, and clears with `Don’t repeat`. `swift test` replays the shared recurrence rules through `VectorTests`.

## Gotchas

- A recurring task never shows up as completed. It is one task whose date moves. Assert the new date, not a missing row.
- The next date is the first occurrence after today, so completing an overdue daily task lands on tomorrow, not the day after the old due date.
- Setting a repeat on an undated task dates it today, and removing the date removes the repeat.
- A reminder whose new time passes while the app is closed fires on the next load. Change the clock and reload rather than waiting 15 seconds.
- The weekday toggles show one letter and are named `Mon` to `Sun`. Match them by exact name, because `Mon` also matches `Every month`.
- Toggles align from the due date the menu opened with, so toggle order never changes the result.
- A popover in a sheet stays below the sheet's header, so `Close` is always reachable. On a phone the repeat menu opens above the chip and scrolls inside that space.
