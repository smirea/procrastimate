# Task views

Task views let Stefan see his tasks three ways: Inbox for everything without a project, Today for tasks due today or overdue, and Upcoming for tasks by date. Switching views is instant.

## Sub-features

- `views-inbox` lists tasks without a project.
- `views-today` lists tasks due today, with overdue tasks marked.
- `views-upcoming` groups future tasks by day.
- `views-empty` shows an empty state in each view.

## How to get to it (user POV)

- Web: choose Inbox, Today, or Upcoming in the sidebar.
- Web: open each view by keyboard shortcut. Planned: shortcuts are not chosen yet.
- iOS: tap Inbox, Today, or Upcoming in the main navigation.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, seeded with `Overdue task` due yesterday, `Today task` due today, `Later task` due in three days, and `Someday task` with no date.

- **Inbox.** Planned: open Inbox on the web. It lists all four tasks.
- **Today.** Planned: open Today. It lists `Today task` and `Overdue task`, with `Overdue task` marked overdue.
- **Upcoming.** Planned: open Upcoming. `Later task` appears under its day and `Someday task` is absent.
- **Empty.** Planned: complete `Today task` and `Overdue task`, then open Today. The empty state appears.
- **iOS.** Planned: repeat the Today step in the simulator. It shows the same tasks.
- **Proof.** Planned: capture a snapshot and screenshot of each view.

## Gotchas

- Today depends on the device clock and time zone. Seed dates relative to the run, not fixed calendar dates.
- A view that shows a spinner on local data fails the snappiness requirement.
