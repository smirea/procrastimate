# Reminders

Reminders let Stefan get nudged about a task, either a set time before it is due or at a specific date and time. He adds them from the bell chip or by typing phrases like `remind me 30m before`. A due time is a reminder too, so a task with a due time notifies at that time without one. While the app is open, a reminder shows a toast. With notifications turned on, Web Push also delivers a system notification, even while the app is closed (see [Push notifications](./push-notifications.md)).

## Sub-features

- `reminders-nl` parses `remind me 30m before`, `remind 5m before`, `r5m`, `r1h`, `remind me 1 hour before`, `remind me at 4pm`, and `remind me tomorrow 9am`.
- `reminders-picker` adds a relative reminder (at due time, 10m, 30m, 1h, or 1d before) or a custom date and time, and removes reminders.
- `reminders-fire` shows a `Reminder: <title>` toast with `Open` when a reminder comes due.
- `reminders-due-time` notifies at a task's due time with no reminder set. Reminders add to it, a date with no time never notifies, and a reminder at the due time notifies once.
- `reminders-notify` delivers each moment as a system notification through Web Push once notifications are on. While the web app is open and offline, it shows that notification itself, under the push's tag so a late push replaces it. See [Push notifications](./push-notifications.md).

## How to get to it (user POV)

- Web: type a reminder phrase in quick add or the task details title.
- Web: choose the bell chip in quick add or task details.
- iOS: type a reminder in quick add or use the reminders chip in task details, then relaunch the app after it comes up.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with an empty Inbox. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- Unit proof for the parser and the schedule: `bun test shared/quick-add.test.ts shared/notifications.test.ts`.

- **Typed relative reminder.** In quick add, type `call mom tomorrow 5pm remind me 30m before`. `remind me 30m before` is highlighted and a `30m before` chip appears. The saved row shows one reminder. Unit test: `call mom tomorrow 5pm remind me 30m before` in `shared/quick-add.test.ts`.
- **Typed shorthand.** In quick add, type `Call Tom about the sun hat tom 5p r30m`. `r30m` is highlighted and a `30m before` chip appears.
- **Typed absolute reminder.** Type `Renew passport fri remind me at 9am`. A `Friday 9am` chip appears and the saved row shows one reminder.
- **Picker.** Type `Standup today 10:30am`, open `Add reminder`, and choose `10m before`. The menu closes and the chip reads `1 reminder`. Save, open the task, and open its reminder chip. It lists `10m before`.
- **Fire.** Move the clock to 10:21 with the app open. Within 15 seconds a `Reminder: Standup` toast appears.
- **Due time notifies.** Add `Call mom today 10:30am`, `Taxes today`, `Standup today 10:45am remind me at 10:45am`, and `Gym today 11am remind me 30m before`. Move the clock to 10:31 and reload. `Reminder: Call mom` and `Reminder: Gym` toasts show and no `Taxes` or `Standup` toast does. At 10:46 after a reload, exactly one `Reminder: Standup` toast shows. At 11:01 after a reload, `Reminder: Gym` shows again for its due time and `Taxes` never does. Unit tests: `a reminder at the due time notifies once` and `completed tasks, dates without a time, and past moments never notify` in `shared/notifications.test.ts`.
- **iOS.** `remind me 30m before` highlights, shows a `30m before` chip, and the saved row reads `1 reminders`. While the app is open, each due time and reminder shows `Reminder: <title>` with `Open`, a date alone never does, and a moment shows once: relaunching at 10:31 shows `Call mom` and `Gym`, at 10:46 `Standup` once. System notifications while closed are in Push notifications. In task details the reminders chip adds `30m before` and a custom date and time, which defaults to the due date at 9am, and `Remove reminder` takes one off.

## Gotchas

- A due time notifies by itself, so the reminder chip can read `Remind` on a task that will still notify. A date with no time never notifies.
- A relative reminder needs a due time. The picker disables relative presets until the task has one.
- An absolute reminder without a date uses the due date typed in the same text, then the date already picked or set on the task, then today. One without a time uses 9am. One with a time but no date and no due date lands today, or tomorrow once that time has passed.
- In-app toasts fire only while the web app is open. Background delivery needs push turned on, and on iPhone the app added to the Home Screen.
- The app checks for due reminders every 15 seconds and fires each one once, so a reminder time that already passed before the app opened does not fire.
- Headless browsers deny notification permission. Verify the toast here, and system notifications with [Push notifications](./push-notifications.md).
