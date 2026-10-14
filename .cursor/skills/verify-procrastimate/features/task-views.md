# Task views

Inbox lists everything dated by day: Overdue, Today, and each later day with dated tasks from every project. No date lists the undated top-level tasks that have no project. Project, label, place, and event lists are covered by their own feature files. Each list animates as tasks arrive and leave.

## Sub-features

- `views-inbox` lists Overdue, Today, and each later day under a heading such as `Tomorrow`. It holds only dated tasks.
- `views-no-date` lists undated top-level tasks without a project. It is an iOS tab and a web sidebar entry at `/no-date` with its count.
- `views-today` and `views-upcoming` are removed. Their lists are the Inbox's dated sections.
- `views-empty` shows `Nothing scheduled` with `Tasks with a date show up here by day.` on an Inbox with nothing dated. An empty No date shows `Inbox zero` with `Press Q to capture a task.`, or `Tap + to capture a task.` on a phone and iOS.
- `views-counts` shows the Inbox count, overdue plus today, in the web sidebar and as the iOS tab badge. The web sidebar also counts No date. The iOS No date tab has no badge.
- `views-compact` (iOS only) shows rows without separators and 6 pt vertical padding. The Inbox root has no navigation bar and fades a small `Inbox` title in once scrolled. Pushed lists use an inline bar with the same small title on scroll.

## How to get to it (user POV)

- Web: choose Inbox or No date in the sidebar. No date sits under Inbox.
- Web on a phone: tap `Open navigation`, then Inbox. The drawer closes as the view opens. Tapping outside the drawer closes it.
- iOS: tap the Inbox or No date tab. The tab bar has Inbox, No date, and Browse, plus the accent `+` in the separate trailing circle.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state. Seed through quick add: with the clock one day earlier, add `Overdue task today`. With the clock back, add `Today task today`, `Later task in 3 days`, and `Someday task`. The steps below assume Wednesday, October 14 2026.
- No automated test covers this feature. Drive it by hand with `control-ui` on web and through the simulator on iOS.

- **Inbox.** Open Inbox. `Overdue` lists `Overdue task` marked `Yesterday`. `Today` lists `Today task`. `Later task` is under `Saturday`. `Someday task` is not in Inbox. The sidebar count, or the iOS tab badge, reads 2.
- **No date.** Open No date. It lists `Someday task`. The web sidebar count reads 1.
- **Places in No date.** On iOS, launch with `PROCRASTIMATE_DEMO="seed nodate"`. `Buy oat milk` is at the top, alone at its place. `Try the seasonal blend` and `Ask about decaf beans` sit below under a `Philz Coffee` heading.
- **Other projects.** Add `Project task tomorrow #Work` after creating `Work`. It shows under `Tomorrow` with its project named, and not in No date.
- **Empty.** Complete every task. Inbox shows `Nothing scheduled` with `Tasks with a date show up here by day.`. No date shows `Inbox zero` with `Press Q to capture a task.`, or `Tap + to capture a task.` on a phone.
- **Phone.** Tap `Open navigation`; the `Main` navigation slides in. Tap outside it; it closes. Open Inbox; the same sections show. Open No date; `Someday task` shows.
- **iOS.** The Inbox tab lists the same sections as the web and shows `Nothing scheduled` when empty. The No date tab lists `Someday task` and shows `Inbox zero` when empty. Launch with `PROCRASTIMATE_DEMO=nodate` to open it directly. The Inbox tab carries the overdue plus today count as its badge. Rows have no separators. The bar is hidden at the top, and a small `Inbox` title fades in once the list scrolls. Lists sit on the same tinted canvas as the web with transparent rows.
- **Proof.** Save a screenshot of the Inbox with every section on each client.

## Gotchas

- The Inbox's day sections depend on the device clock and time zone. Seed dates relative to the run, not fixed calendar dates. To seed an overdue task through the UI, set the clock back a day, reload, add it, then restore the clock and reload.
- The app reads the clock every 15 seconds, so a clock change shows after a reload or within 15 seconds.
- A view that shows a spinner on local data fails the snappiness requirement.
