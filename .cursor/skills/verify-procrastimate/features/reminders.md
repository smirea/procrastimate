# Reminders

Reminders let Stefan get nudged about a task, either a set time before it is due or at a specific date and time. He adds them from the bell chip or by typing phrases like `remind me 30m before`. A due time is a reminder too, so a task with a due time notifies at that time without one. Every reminder is a system notification titled with the task, its body the due day and time such as `Today 3:00 PM`. There is no in-app toast. Web Push delivers it even while the app is closed (see [Push notifications](./push-notifications.md)).

## Sub-features

- `reminders-nl` parses `remind me 30m before`, `remind 5m before`, `r5m`, `r1h`, `remind me 1 hour before`, `remind me at 4pm`, and `remind me tomorrow 9am`.
- `reminders-picker` adds a relative reminder (at due time, 10m, 30m, 1h, or 1d before) or a custom date and time, and removes reminders.
- `reminders-fire` shows a system notification, never an in-app toast, when a reminder comes due. On the web without push, or offline, the open app shows it itself.
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
- **Fire.** With push off and notification permission granted (the e2e stubs `Notification` and removes `PushManager`), move the clock to 10:21 and reload. A `Standup` notification with body `Today 10:30 AM` shows. `e2e/recurring.e2e.ts` does this for a repeating task.
- **Due time notifies.** Add `Call mom today 10:30am`, `Taxes today`, `Standup today 10:45am remind me at 10:45am`, and `Gym today 11am remind me 30m before`. Move the clock to 10:31 and reload. `Call mom` and `Gym` notifications show and no `Taxes` or `Standup` one does. At 10:46 after a reload, exactly one `Standup` notification shows. At 11:01 after a reload, `Gym` shows again for its due time and `Taxes` never does. Unit tests: `a reminder at the due time notifies once` and `completed tasks, dates without a time, and past moments never notify` in `shared/notifications.test.ts`.
- **iOS.** `remind me 30m before` highlights, shows a `30m before` chip, and the saved row reads `1 reminders`. Each due time and reminder is a time-sensitive local notification whose banner shows in the foreground too, a date alone never notifies, and a moment notifies once. See Push notifications. In task details the reminders chip adds `30m before` and a custom date and time, which defaults to the due date at 9am, and `Remove reminder` takes one off.

## Gotchas

- A due time notifies by itself, so the reminder chip can read `Remind` on a task that will still notify. A date with no time never notifies.
- A relative reminder needs a due time. The picker disables relative presets until the task has one.
- An absolute reminder without a date uses the due date typed in the same text, then the date already picked or set on the task, then today. One without a time uses 9am. One with a time but no date and no due date lands today, or tomorrow once that time has passed.
- Background delivery on the web needs push turned on, and on iPhone the app added to the Home Screen.
- Without push, the open web app checks for due reminders every minute and shows each once, so a reminder time that already passed before the app opened does not show.
- Headless browsers deny notification permission, so specs stub `Notification`.
