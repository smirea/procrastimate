# Places and events

A task can hang off a place or a calendar event, set with the Location and Event chips in task details or quick add on the iPhone, never by typing. A place comes from an Apple Maps search and fires on arrival, on leaving, or shows a Live Activity of the place's tasks while Stefan is there. An event comes from the iPhone's calendar and puts the task on a moment of it: before, at the start, during, or after, with reminders counting back from that moment. Moved events move their tasks. Places and events with open tasks get their own Browse sections above Labels. Neither has quick add or Ramble phrases.

## Sub-features

- `place-pick` sets a place from the `Location` chip: an Apple Maps search with `Arrive`, `Leave`, or `During` beside the field.
- `place-permission` asks for location access the first time a place is set, and asks to upgrade to Always.
- `place-arrive` notifies on arriving, `place-leave` on leaving, never for the state the phone was already in when the place was set.
- `place-during` starts a Live Activity listing the place's open `During` tasks while inside, and ends it on leaving.
- `place-arming` watches at most 20 places, and a place with a due date or reminders only from the start of its due day or its first reminder.
- `event-pick` links a calendar event from the `Event` chip, with the moment and minutes, and `Only this one` for a repeating event.
- `event-replaces-date` hides the date and repeat chips while an event is linked and drops the due date and repeat; the reminder chip offers only presets before the event's moment.
- `event-sync` rewrites a linked event's times when it moves in the calendar.
- `rows` show the event line (`15m after Standup`, tinted by its day) and the place line (`Arriving at Whole Foods Market`).
- `browse-sections` lists Places and Events above Labels while open tasks use them, each opening its tasks.

## How to get to it (user POV)

- iOS: open a task, tap `Location` (after the reminder chip), search, pick `Arrive`, `Leave`, or `During`, and tap a result. Tap the chip again to change the trigger or `Remove location`.
- iOS: open a task, tap `Event`, pick the moment and an upcoming event, and tap `Save`. Tap the chip again to change it or `Remove event`.
- iOS: Browse tab, `Places` and `Events` sections.
- Web: shows the place and event lines on rows, read-only `During Walking meetup · Oct 21 6pm` and `While at Tiergarten` chips in task details (the event chip replaces the date and repeat pickers), and `Places` and `Events` sidebar sections above Labels opening `/places/<key>` and `/events/<id>`. It cannot set either.
- Web check: seed tasks with `location` and `event` into the `procrastimate` localStorage document and reload. Inbox places `Night out` under its day as `<time> (30m before [calendar] Night out)`, and a weekly task at a place due last week shows on its next occurrence instead of overdue.

## Driving it with simctl

Preconditions:

- A booted iOS 27 simulator, the app built with `xcodebuild` for it and installed. `UDID` is the simulator's identifier.
- `xcrun simctl privacy $UDID grant location-always com.stefan.procrastimate` and `xcrun simctl privacy $UDID grant calendar com.stefan.procrastimate`. Notifications cannot be granted through `simctl`; allow the prompt once by hand.
- The DEBUG launch key `PROCRASTIMATE_DEMO` stands in for taps, as space-separated words: `seed` adds `Standup` (daily) and `Dentist` to the calendar and seeds `Buy oat milk` (arrive at Whole Foods Market), two `During` tasks at Philz Coffee, `Post standup notes` (15m after Standup), and `Floss first` (1h before Dentist); `browse` opens Browse; `nodate` opens the No date tab; `details:<title with + for spaces>` opens a task; `sheet:location` or `sheet:event` opens that chip's sheet; `query:<words>` fills the Maps search; `quickadd` opens quick add; `ramble` opens quick add listening; `search` opens Browse with its search field focused; `type:<text with + for spaces>` types into the focused field through `UIKeyInput` one character at a time, then logs `PlacesDemo typed: …`; `move` moves the next Standup an hour later and logs the task's occurrences before and after. Pass it as `SIMCTL_CHILD_PROCRASTIMATE_DEMO`, with `SIMCTL_CHILD_PROCRASTIMATE_SIGNED_IN=1`.

- **Seed and Browse.** Launch with `seed browse`. Browse shows `Places` (`Philz Coffee 2`, `Whole Foods Market 1`) and `Events` (`Standup 1`, `Dentist 1`) above Labels. Screenshot with `xcrun simctl io $UDID screenshot`.
- **Rows.** Launch with `seed`. Event rows read like `4:15pm ([repeat] 15m after [calendar] Standup)`: the task's moment in its due tone, then in gray the repeat icon when the task follows a series, the lead, the calendar icon, and the event title. The moment is the edge applied to the occurrence, with day and time joined by a space. It keeps the day even under a day heading. It is worded like any due date but drops the day for today (`4:15pm`, `Tomorrow 2pm`, `Tuesday 8:30am`, `Oct 21 6pm`), and has no time for an all-day event. `Post standup notes` reads `<moment> ([repeat] 15m after [calendar] Standup)` with `1` reminder, and `Floss first` reads `<moment> (1h before [calendar] Dentist)`. Their moments depend on the day the seed ran. In the No date tab, `Buy oat milk` sits at the top and the two Philz Coffee tasks group under a `Philz Coffee` heading. Event rows have no postpone swipe.
- **Details chips.** `details:Post+standup+notes` shows the event chip first with no `Date` or `Repeat` chip. `details:Buy+oat+milk` shows `Date`, `Repeat`, `Priority`, `Remind`, `Arriving at Whole Foods Market`, and `Event`.
- **Sheets.** `details:Buy+oat+milk sheet:location` shows the map of the current place with `Remove location`. `details:Try+the+seasonal+blend sheet:location query:philz` lists Philz Coffee results with `During` beside the field. `details:Post+standup+notes sheet:event` shows `After` selected, `Minutes after 15m`, `Only this one`, and upcoming events by day with Standup checked.
- **Arrive.** `xcrun simctl location $UDID set 37.3349,-122.0090`, launch, wait 15 seconds, then `xcrun simctl location $UDID set 37.3236,-122.0397`. Within about ten seconds the open app shows the toast `Buy oat milk · Arriving at Whole Foods Market` with `Open`.
- **During.** `xcrun simctl location $UDID set 37.3229,-122.0322` with the app open starts one Live Activity for Philz Coffee; `log show --predicate 'eventMessage CONTAINS "procrastimate.widgets"'` shows the renderer subscribing. Moving away ends it the next time the app runs.
- **Moved event.** Launch with `move` and read `PlacesDemo before move` and `after move` from the console: the first occurrence starts an hour later and the series continues.

## Gotchas

- The first state report after a place is set never notifies, so start outside a place before moving into it.
- The simulator does not wake a suspended app for a crossing the way a phone does, and `simctl io` screenshots do not show the Dynamic Island or the lock screen. Background delivery and the Live Activity's look need a device.
- A Live Activity can only start while the app is in the foreground. A `During` crossing in the background notifies instead, and the activity starts when the app next opens while still inside.
- Moving one occurrence of a repeating event detaches it, and its identifiers gain `/RID=<date>`. It still belongs to the series.
- The seeded calendar events stay in the simulator's calendar across resets; `seed` adds them only once.
