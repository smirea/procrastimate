# Siri, Shortcuts, and Spotlight

Siri, the Shortcuts app, and Spotlight can drive the iOS app: add a task in the same words as quick add, complete or reopen one, open Inbox, Today, Upcoming, a project, or a task, search, and hear what is due today or overdue. Open tasks show up in Spotlight. The web client has none of this, because App Intents, Siri, Shortcuts, and Spotlight are iOS.

Every new feature that someone can do from outside the app ships its intents, phrases, and entities in the same change.

## Sub-features

- `intent-add` adds a task from a spoken or typed title, using the quick-add grammar, with optional project, labels, priority, due, and reminder fields that fill only what the title left unset.
- `intent-complete` completes the open task with that title.
- `intent-reopen` reopens a completed task.
- `intent-open-view` opens Inbox, Today, or Upcoming.
- `intent-open-project` opens a project.
- `intent-open-task` opens a task.
- `intent-search` searches tasks and shows the matches.
- `intent-today` lists tasks due today.
- `intent-overdue` lists overdue tasks.
- `intent-spotlight` indexes open tasks and drops a task from Spotlight once it is completed.
- `intent-delete-all` deletes every task, project, and label on this device. The next sync wipes them on the server. It stays available in Shortcuts, without a suggested phrase: App Shortcuts keep ten, and Start Ramble uses that slot.
- `intent-ramble` opens quick add and starts the mic. Siri and Shortcuts offer "Start Ramble in Procrastinate".

## How to get to it (user POV)

- iOS, Siri: "Add a task in Procrastinate", "Complete Buy milk in Procrastinate", "Reopen Buy milk in Procrastinate", "Open Today in Procrastimate", "Show Upcoming in Procrastimate", "Open project House in Procrastinate", "Open task Buy milk in Procrastinate", "Search tasks in Procrastinate", "What is due today in Procrastinate", "What is overdue in Procrastinate", "Start Ramble in Procrastinate". The title and the search words are the follow-up question, because an App Shortcut phrase can only fill an entity or an enum.
- iOS, Shortcuts: the same actions appear in the Shortcuts app, and a shortcut can set the project, labels, priority, due date, and reminder on Add Task.
- iOS, Spotlight: search for an open task's title. Tapping the result opens it.
- Web: not available.

## Driving it with XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The automated suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- iOS only. Run `AppIntentsParityTests` in the iOS workflow (`xcodebuild test` on an iPhone 16 simulator).

- **Add.** The intent adds `Call mom tomorrow 5pm p1 remind me 30m before`. Inbox shows `Call mom` with `Tomorrow 5pm`, one reminder, and a `Priority 1` checkbox. A title that is only `tomorrow` adds nothing. Test: `AppIntentsParityTests.test_intent_add`.
- **Project, label, and fields.** With project `House` and label `calls` already created, the intent adds `Ping Ana #House @calls p2 tomorrow`, and `House` shows `Ping Ana` with `Tomorrow`, `calls`, and `Priority 2`. A second add sets the project, label, priority, due, and reminder as fields rather than words: `Submit report` shows `Tomorrow 5pm`, `calls`, one reminder, and `Priority 1`. Test: `AppIntentsParityTests.test_intent_project_labels_and_parameters`.
- **Complete.** `Buy milk` leaves the list and `Call mom` stays. Test: `AppIntentsParityTests.test_intent_complete_and_spotlight`.
- **Reopen.** After `Buy milk` is completed, reopening puts it back. Test: `AppIntentsParityTests.test_intent_reopen`.
- **Lists.** Opening Today, Upcoming, and Inbox shows that list. Test: `AppIntentsParityTests.test_intent_open_views`.
- **Task.** Opening `Buy milk` presents task details. Test: `AppIntentsParityTests.test_intent_open_task`.
- **Search.** Searching `milk` shows `Buy milk` and not `Call mom`. Test: `AppIntentsParityTests.test_intent_search`.
- **Today and overdue.** With the clock a day earlier, add `Overdue task today`, then return to the pinned day and add `Pay rent today`. Today lists both, the overdue readout names `Overdue task`, and the today readout names `Pay rent`. Test: `AppIntentsParityTests.test_intent_today_and_overdue`.
- **Spotlight.** After `Buy milk` is completed, the indexed titles are `Call mom` only. Completing is the same test as `test_intent_complete_and_spotlight`.

## Gotchas

- The phrases above only work when they include the app name, `Procrastimate`.
- `#Project` and `@label` match records that already exist. They do not create one.
- Words in the title win over a Shortcuts field for the same detail. A field applies only when the title did not set it.
- A spoken title ignores case and accents. When several open tasks share it, the newest one is first.
- Dates follow the device clock. The suite is pinned to Wednesday, October 14 2026, 10:00 UTC. `Tomorrow 5pm` is October 15.
- The CI simulator cannot drive Siri. The UI test runs the intent itself. Trying the phrases means a device with Siri.
- Spotlight lists open tasks only. A completed task disappears from the index.
