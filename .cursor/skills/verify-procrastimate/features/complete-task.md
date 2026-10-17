# Complete a task

Complete a task lets Stefan check off a task with a short, satisfying animation, undo it right away, and find it later among completed tasks.

## Sub-features

- `complete-check` marks a task done and animates it out of the list.
- `complete-undo` restores the task to its place.
- `complete-recurring` moves a recurring task to its next occurrence instead of closing it. [Recurring tasks](./recurring-tasks.md) covers it.
- `complete-subtasks` completes every open subtask under the task too. [Subtasks](./subtasks.md) covers it.
- `complete-reopen` reopens a completed task with `Reopen` in task details, reached through [Search](./search.md), which covers it.
- `complete-history` is the Completed view: every own completed task under the day it was completed, newest first. Each row shows when (`Today 10am`, `Oct 12 3pm`), its project, and `by <name>` when someone else completed it. A recurring task shows once, at its latest roll, with the repeat icon.
- `complete-range` filters Completed by `Today`, `Last 7 days` (default), `Last 30 days`, `All time`, or a custom range. The choice persists per device.
- `complete-toggle` is `Show completed` in project and label views. Each project and label keeps its own, per device. A label lists its completed tasks below the open ones under `Completed`. A project shows each completed task under the open ones of its own section, loose ones with the loose tasks, and only tasks whose section is gone under a bottom `Completed` heading.
- `complete-reopen-row` reopens a task from its filled checkbox in any completed list, with a `Reopened “X”` toast and Undo.
- `complete-delete-row` deletes a completed task from its row, with a `Deleted “X”` toast and Undo: the trash button at the end of the row on the web (on hover, always shown on touch), and `Delete` in the row menu on both clients (see `edit-row-menu` in [Edit a task](./edit-task.md)). A task the user may only view, and a repeating task's past completion, have none.

## How to get to it (user POV)

- Web: choose the checkbox next to a task. Its ring is tinted by priority.
- Web: choose `Complete` in task details, or in a row's menu (right click, long press, or Shift+F10).
- Web on a phone: tap the checkbox. Its tap target is 44 px even though the ring is smaller.
- Web: choose `Completed` in the sidebar, under No date, or open `/completed`. `Show completed` is the check-circle button in a project or label header.
- iOS: tap `Completed` at the very bottom of Browse. `Show completed` is in the project or label `…` menu.
- Web: press `e` with a task selected. Planned: task selection by keyboard is not built yet.
- iOS: tap the checkbox next to a task.
- iOS: swipe a task right to complete it.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk` and `Pay rent` through quick add.

- **Complete.** Check `Buy milk` with the `Complete Buy milk` checkbox. The checkbox fills, the title strikes through, and the row slides out. Inbox shows only `Pay rent` and an `Undo` toast appears.
- **Undo.** Choose `Undo` in the toast. `Buy milk` returns above `Pay rent`.
- **Phone.** Seed `Buy milk` and `Pay rent`, then tap 8 px left of the `Complete Buy milk` ring. The row leaves and the `Undo` toast appears above the `Quick add` button. Tap `Undo`; `Buy milk` returns.
- **History.** Complete `Buy milk` again and open Completed. `Buy milk` is under `Today` with `Today 10am` and `Inbox`. Seed an older completion by setting the clock to October 1, adding and completing `Old report`, then restoring the clock; it is missing under `Last 7 days`.
- **Range.** Open `Completed Last 7 days` and choose `All time`; `Old report` shows under `Thu, Oct 1`. Under `Custom range` set From `2026-10-01` and To `2026-10-12` and choose `Apply`; the button reads `Completed Oct 1 – Oct 12` and today's tasks leave. Reload; the range stays.
- **Reopen.** Choose `Reopen Buy milk`. The row leaves and `Reopened “Buy milk”` shows; `Undo` brings it back.
- **Toggle.** Add `Buy milk #Home`, complete it, open `Home`, and choose `Show completed`. It shows struck through under the open tasks, in the list `Completed Home tasks`. In a project with sections, a task completed in `Next up` shows in `Completed Next up tasks` right under that section's open tasks (iOS: under that section's header). Reopening it moves it back to the open list.
- **Per view, and delete.** `Show completed is per project, and a completed task deletes with undo` in `e2e/projects.e2e.ts`: turning it on in `Garden` leaves `Home` off and survives a reload, and `Delete Rake leaves` on the completed row shows `Deleted “Rake leaves”`, whose Undo puts the row back. On iOS, turn it on in `Garden` (`PROCRASTIMATE_DEMO=sharing`), then open `Trip to Lisbon`: its `Show completed` is off. Long press a completed row there: the menu has `Reopen`, `Delete`, and `Copy as Markdown`.
- **Someone else.** In the sharing smoke (`a guest completes a task…` in `e2e/sharing.e2e.ts`), the owner's `Show completed` row reads `by Gus`. On iOS, launch with `PROCRASTIMATE_DEMO=sharing`, open Garden, and turn on `Show completed`: `Rake the leaves` reads `by Claude` with the `AI` badge and `Order seeds` `by Ann Lee`.
- **iOS.** Tap the checkbox of `Pay rent` in the simulator: it fills with a success haptic, the row animates out, and `Completed “Pay rent”` shows with `Undo`, which restores it. A leading swipe completes too. The trailing swipe postpones instead (see Edit a task). `Standup every fri 9am` moves to `Oct 23 9am` with `Completed “Standup”, next due Oct 23 9am`. Drive it with `bun run start:ios -t simulator`.
- **iOS Completed.** Tap `Completed` at the very bottom of Browse. The same day sections show, the range menu at the top right reads `Last 7 days` and offers the presets and `Custom range…`, which opens From and To pickers. Tap `Reopen Pay rent`; `Reopened “Pay rent”` shows with `Undo`. A leading swipe or the context menu reopens too.
- **Proof.** Planned: record the check and undo on the web as motion proof, then reload and capture Inbox.

## Gotchas

- Completed days and times are local. A completion near midnight lands on the day the device's time zone says.
- The undo toast lasts five seconds. Act on it before it disappears.
- The row leaves about 260 ms after the click, once the check animation plays. Wait for the row to be gone, not for a fixed delay.
- A screenshot cannot prove the animation. Record motion proof.
- The checkbox must respond on the first frame. Treat a delay before the animation starts as a failure.
