# Task views

Task views let Stefan see his tasks three ways: Inbox for everything without a project, Today for tasks due today or overdue, and Upcoming for tasks after today grouped by day. Switching views is instant and each list animates as tasks arrive and leave.

## Sub-features

- `views-inbox` lists tasks without a project.
- `views-today` lists tasks due today, with overdue tasks in their own section.
- `views-upcoming` groups tasks due after today by day.
- `views-empty` shows an empty state in each view.
- `views-counts` shows each view's open task count in the sidebar.

## How to get to it (user POV)

- Web: choose Inbox, Today, or Upcoming in the sidebar.
- Web on a phone: tap `Open navigation`, then a view. The drawer closes as the view opens. Tapping outside the drawer closes it.
- Web: open each view by keyboard shortcut. Planned: shortcuts are not chosen yet.
- iOS: tap Inbox, Today, or Upcoming in the main navigation.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state. Seed through quick add: with the clock one day earlier, add `Overdue task today`. With the clock back, add `Today task today`, `Later task in 3 days`, and `Someday task`.
- Automated proof for every web step: `bun run test:e2e -- e2e/views.e2e.ts`. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.

- **Inbox.** Open Inbox. The `Inbox tasks` list has all four tasks. Test: `Inbox, Today, and Upcoming show the right tasks`.
- **Today.** Open Today. The subtitle reads `Wednesday, October 14`. The `Overdue tasks` list has `Overdue task` marked `Yesterday`, and the `Today tasks` list has `Today task`.
- **Upcoming.** Open Upcoming. `Later task` is under the `Oct 17 · Saturday` group. `Someday task` and `Today task` are absent.
- **Empty.** Complete `Today task` and `Overdue task` from Today. `All clear for today` appears. On a fresh store, Inbox shows `Inbox zero` and Upcoming shows `Nothing scheduled`. Test: `each view has an empty state`.
- **Phone.** Seed `Standup today 10:30am p2`, `Review PR today 3pm p1 remind me 30m before`, `Call mom tomorrow 5pm`, `Dentist in 3 days 2pm`, and `Buy milk`. Tap `Open navigation`; the `Main` navigation slides in. Tap outside it; it closes. Open Today; `Today tasks` lists `Standup` then `Review PR`. Open Upcoming; `Dentist` is under `Oct 17 · Saturday`. The empty Inbox hint reads `Tap + to capture a task.` Test: `the navigation drawer opens, closes, and switches views` in `bun run test:e2e -- e2e/mobile.e2e.ts`.
- **iOS launch.** The app opens on Inbox with `Inbox zero`, at the pinned moment and with an empty store. Test: `ShellParityTests.test_shell_launch` in the iOS workflow, paired with `shell-launch: the app opens on an empty Inbox` in `bun run test:e2e --project=parity`. Both save `shell-launch.png`.
- **iOS.** Planned: repeat the Today step in the simulator. It shows the same tasks.
- **Proof.** The suite saves `app-web/test-results/view-inbox.png`, `view-today.png`, and `view-upcoming.png`, and the phone screens as `app-web/test-results/mobile/inbox.png`, `navigation-open.png`, `today.png`, and `upcoming.png`.

## Gotchas

- Today depends on the device clock and time zone. Seed dates relative to the run, not fixed calendar dates. To seed an overdue task through the UI, set the clock back a day, reload, add it, then restore the clock and reload.
- The app reads the clock every 15 seconds, so a clock change shows after a reload or within 15 seconds.
- A view that shows a spinner on local data fails the snappiness requirement.
