# Reminders

Reminders let Stefan get nudged about a task, either a set time before it is due or at a specific date and time. He adds them from the bell chip or by typing phrases like `remind me 30m before`. While the app is open, a reminder shows a toast and, if the browser allows, a system notification.

## Sub-features

- `reminders-nl` parses `remind me 30m before`, `remind 5m before`, `r5m`, `r1h`, `remind me 1 hour before`, `remind me at 4pm`, and `remind me tomorrow 9am`.
- `reminders-picker` adds a relative reminder (at due time, 10m, 30m, 1h, or 1d before) or a custom date and time, and removes reminders.
- `reminders-fire` shows a `Reminder: <title>` toast with `Open` when a reminder comes due.
- `reminders-notify` asks for notification permission when the first reminder is added and sends a system notification when allowed.

## How to get to it (user POV)

- Web: type a reminder phrase in quick add or the task details title.
- Web: choose the bell chip in quick add or task details.
- iOS: Planned: not built yet.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for every web step: `bun run test:e2e -- e2e/priority-reminders.e2e.ts` (the priority tests in that file are covered by [Priority](./priority.md)).

- **Typed relative reminder.** In quick add, type `call mom tomorrow 5pm remind me 30m before`. `remind me 30m before` is highlighted and a `30m before` chip appears. The saved row shows one reminder. Test: `q opens quick add, parses the brief example inline, and saves it` in `e2e/quick-add.e2e.ts`.
- **Typed shorthand.** In quick add, type `Call Tom about the sun hat tom 5p r30m`. `r30m` is highlighted and a `30m before` chip appears. Test: `shorthands parse inline while names and ordinary words stay text` in `e2e/quick-add.e2e.ts`.
- **Typed absolute reminder.** Type `Renew passport fri remind me at 9am`. A `Friday 9am` chip appears and the saved row shows one reminder. Test: `a reminder typed without a due time stays and defaults to the due date`.
- **Picker.** Type `Standup today 10:30am`, open `Add reminder`, and choose `10m before`. The menu closes and the chip reads `1 reminder`. Save, open the task, and open its reminder chip. It lists `10m before`. Test: `reminders can be added from the UI and fire while the app is open`.
- **Fire.** Move the clock to 10:21 with the app open. Within 15 seconds a `Reminder: Standup` toast appears. Same test.
- **iOS.** Planned: reminders on iOS.

## Gotchas

- A relative reminder needs a due time. The picker disables relative presets until the task has one.
- An absolute reminder without a date uses the due date typed in the same text, then the date already picked or set on the task, then today. One without a time uses 9am. One with a time but no date and no due date lands today, or tomorrow once that time has passed.
- Reminders fire only while the web app is open. There is no background delivery yet.
- The app checks for due reminders every 15 seconds and fires each one once, so a reminder time that already passed before the app opened does not fire.
- Headless browsers deny notification permission. Verify the toast, not the system notification.
