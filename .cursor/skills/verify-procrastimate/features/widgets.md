# Widgets and controls

The iOS app has Home Screen and Lock Screen widgets and Control Center controls. Tasks lists a chosen list's open tasks with checkboxes that complete them, Progress shows a ring of what is done today, and Quick Add opens quick add or Ramble on a list. Each widget is configured with Today or any of the user's own lists. The web client has none of this, because widgets are an iOS system surface.

## Sub-features

- `widget-tasks` lists the configured list's open tasks in screen order, with priority-toned checkboxes, short due dates in their tone (`4:30pm` for today, `Yest.`, `Tmrw`, `Sat`, `Oct 1`), the project, and the open count. A Markdown link in a title shows its label only, and the due date always shows in full while the title truncates.
- `widget-complete` completes a task from its checkbox without opening the app. The system dims the row while the app runs the intent, then the row shows struck through with a filled checkbox for 1.5 seconds, then leaves and the rows below slide up. Every widget showing it updates.
- `widget-open` opens a task from its row and the list from the header. Today opens Inbox.
- `widget-add` opens quick add on the widget's list from the `+`, which the configuration can hide.
- `widget-header` can be turned off in the Tasks configuration (`Show Header`), which hides the icon, name, count, and `+`, and fits one more row (Lock Screen rectangular: three rows instead of two).
- `widget-progress` fills a ring with the list's tasks completed today against the ones still open.
- `widget-quick-add` opens quick add or Ramble on its list.
- `widget-lock-screen` shows Tasks as rectangular and inline, Progress as circular and inline, and Quick Add as circular.
- `widget-controls` adds Add Task, with an optional list, and Ramble to Control Center, the Lock Screen, and the Action button.
- `widget-config` picks the list from Today and every own list, grouped as in Browse. A widget whose project or label is gone says so.

## How to get to it (user POV)

- iOS, Home Screen: touch and hold the Home Screen, tap `Edit`, then `Add Widget`, search `ProcrastiMate`, pick Tasks, Progress, or Quick Add and a size, and tap `Add Widget`. Touch and hold a placed widget and tap `Edit Widget` to pick its list.
- iOS, Lock Screen: touch and hold the Lock Screen, tap `Customize`, then the widget area, and pick a ProcrastiMate widget.
- iOS, Control Center: open Control Center, touch and hold, tap `Add a Control`, and search `ProcrastiMate`.
- Web: not available.

## Driving it with the simulator

Preconditions:

- iOS only. Run a throwaway XCUITest with `./sim test <file.swift>`. Launch the app with `launchApp(demo: "widgets", reset: true)`, which seeds `Renew passport` (overdue, Priority 1), `Call the plumber` (today 4:30pm, Home, Priority 2), `Water the plants` (today, Home, Priority 3), `Buy oat milk` and `Book dentist` (today), `Send invoice` (tomorrow), `Fix the fence` (Home, no date), and `Morning run` completed today, `Look into [Google Maps](https://maps.google.com) offline areas` (today), all relative to the real clock.
- Drive SpringBoard with `XCUIApplication(bundleIdentifier: "com.apple.springboard")`.
- Rule coverage: `swift test` in `app-ios/` runs `WidgetListsTests`.

- **Gallery.** Long-press the Home Screen at the bottom, tap `Edit`, `Add Widget`, tap `Continue` if a keyboard tip shows, type `ProcrastiMate` in `Search Widgets`, and tap the `ProcrastiMate` cell. The previews are buttons labeled `ProcrastiMate, Tasks`, and swiping one left pages through Tasks small, medium, and large, then Progress and Quick Add. The Tasks small preview shows `Today`, `6` in the overdue tone, and `Renew passport`, `Call the plumber`, `Water the plants`, `+3 more`. Choice and row order are covered by `choicesStartWithTodayThenEveryOwnList` and `todayListsOverdueFirstThenTodayByPriority`.
- **Medium.** Adding the second page shows three rows with `Yest.`, `4:30pm` (with `Home` before it when the title leaves room), and `Today` at the end of each line. Formats are covered by `dueDatesDropTodayOrTheTime` and `titlesShowALinksLabelOnly`.
- **Complete.** On the Home Screen, tap the button labeled `Complete Renew passport`. The row dims; on the simulator about 4 seconds later it shows struck through with a filled checkbox and the count reads `5` in the muted tone, and about 1.5 seconds after that the row leaves and the rows below move up. Screenshot every half second to catch it. The struck window is covered by `aCheckedRowShowsStruckInPlaceOnlyInTheFirstEntry` and `checkedRowsLeaveAMomentAfterTheRedrawThatShowsThem`. Opening the app shows `Renew passport` is gone from Inbox.
- **Add.** Tapping a Today widget's `Add task` button opens the app with quick add and its date chip set to today. The rule is covered by `addingFromTodayDatesTheTaskToday`.
- **Ramble.** Tapping `Ramble` on a Quick Add widget opens the Ramble drawer.

## Gotchas

- The widget extension reads the real clock, not `PROCRASTIMATE_NOW`, so seed with `demo: "widgets"` rather than a pinned moment, or every task reads as overdue.
- Widgets pile up across runs on the same simulator. A new one lands after them, so a later run may need to find the newest widget by its frame.
- The checkbox is a `Button`. A widget `Toggle` flips the moment it is tapped, but on the simulator the widget then never redrew after the intent ran (and the intent's `SetValueIntent` value arrived `false`), so the row stayed.
- A widget follows the system appearance, not the app's Light or Dark setting.
