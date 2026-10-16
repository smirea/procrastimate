# Siri, Shortcuts, and Spotlight

Siri, the Shortcuts app, and Spotlight can drive the iOS app: add a task in the same words as quick add, complete or reopen one, open Inbox, No date, Browse, a project, or a task, search, and hear what is due today or overdue. Open tasks show up in Spotlight. The web client has none of this, because App Intents, Siri, Shortcuts, and Spotlight are iOS.

Every new feature that someone can do from outside the app ships its intents, phrases, and entities in the same change.

## Sub-features

- `intent-add` adds a task from a spoken or typed title, using the quick-add grammar, with optional project, labels, priority, due, and reminder fields that fill only what the title left unset.
- `intent-complete` completes the open task with that title.
- `intent-reopen` reopens a completed task.
- `intent-open-view` opens Inbox, No date, or Browse.
- `intent-open-project` opens a project.
- `intent-open-task` opens a task.
- `intent-search` searches tasks, opens Browse with the query in its search field, and shows the matches.
- `intent-today` lists tasks due today.
- `intent-overdue` lists overdue tasks.
- `intent-spotlight` indexes open tasks and drops a task from Spotlight once it is completed.
- `intent-delete-all` deletes every task, project, and label on this device. The next sync wipes them on the server. It stays available in Shortcuts, without a suggested phrase: App Shortcuts keep ten, and Start Ramble uses that slot.
- `intent-ramble` opens the Ramble drawer, already listening. Siri and Shortcuts offer "Start Ramble in ProcrastiMate".

## How to get to it (user POV)

- iOS, Siri: "Add a task in ProcrastiMate", "Complete Buy milk in ProcrastiMate", "Reopen Buy milk in ProcrastiMate", "Open Inbox in ProcrastiMate", "Show Browse in ProcrastiMate", "Open project House in ProcrastiMate", "Open task Buy milk in ProcrastiMate", "Search tasks in ProcrastiMate", "What is due today in ProcrastiMate", "What is overdue in ProcrastiMate", "Start Ramble in ProcrastiMate". The title and the search words are the follow-up question, because an App Shortcut phrase can only fill an entity or an enum.
- iOS, Shortcuts: the same actions appear in the Shortcuts app, and a shortcut can set the project, labels, priority, due date, and reminder on Add Task.
- iOS, Spotlight: search for an open task's title. Tapping the result opens it.
- Web: not available.

## Driving it with the simulator

Preconditions:

- The baseline state, with an empty Inbox. Dates below assume Wednesday, October 14 2026, 10:00 UTC.
- iOS only. Run the app with `bun run start:ios -t simulator`, then run each intent from the Shortcuts app.
- Rule coverage: `swift test` in `app-ios/` runs `IntentRulesTests`.

- **Add.** The intent adds `Call mom tomorrow 5pm p1 remind me 30m before`. Inbox shows `Call mom` with `Tomorrow 5pm`, one reminder, and a `Priority 1` checkbox. A title that is only `tomorrow` adds nothing. The rules are covered by `aSpokenTitleUsesTheQuickAddGrammar` and `aPhraseWithNoTitleSavesNothing`.
- **Project, label, and fields.** With project `House` and label `calls` already created, the intent adds `Ping Ana #House @calls p2 tomorrow`, and `House` shows `Ping Ana` with `Tomorrow`, `calls`, and `Priority 2`. A second add sets the project, label, priority, due, and reminder as fields rather than words: `Submit report` shows `Tomorrow 5pm`, `calls`, one reminder, and `Priority 1`. The rules are covered by `anExplicitValueFillsWhatTheTitleLeftUnset` and `theTitleWinsOverAnExplicitValueForTheSameField`.
- **Complete.** `Buy milk` leaves the list and `Call mom` stays. The rules are covered by `completeAndReopenHonorTheChosenStateThenTheOtherMatch`.
- **Reopen.** After `Buy milk` is completed, reopening puts it back. The rules are covered by `completeAndReopenHonorTheChosenStateThenTheOtherMatch`.
- **Lists.** Opening Browse and then Inbox shows that tab.
- **Task.** Opening `Buy milk` presents task details.
- **Search.** Searching `milk` opens Browse with `milk` in its field and shows `Buy milk` and not `Call mom`. The rules are covered by `searchReturnsOpenHitsBeforeCompletedOnes`.
- **Today and overdue.** With the clock a day earlier, add `Overdue task today`, then return to the pinned day and add `Pay rent today`. Inbox lists both, the overdue readout names `Overdue task`, and the today readout names `Pay rent`.
- **Spotlight.** After `Buy milk` is completed, the indexed titles are `Call mom` only. The rules are covered by `spotlightIndexesOpenTasksOnly`.

## Gotchas

- The phrases above only work when they include the app name, `ProcrastiMate`.
- `#Project` and `@label` match records that already exist. They do not create one.
- Words in the title win over a Shortcuts field for the same detail. A field applies only when the title did not set it.
- A spoken title ignores case and accents. When several open tasks share it, the newest one is first.
- Dates follow the device clock. With the clock at Wednesday, October 14 2026, 10:00 UTC, `Tomorrow 5pm` is October 15.
- The simulator cannot drive Siri. Run the intent from Shortcuts. Trying the phrases means a device with Siri.
- Spotlight lists open tasks only. A completed task disappears from the index.
