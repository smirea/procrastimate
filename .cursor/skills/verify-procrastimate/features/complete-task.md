# Complete a task

Complete a task lets Stefan check off a task with a short, satisfying animation, undo it right away, and find it later among completed tasks.

## Sub-features

- `complete-check` marks a task done and animates it out of the list.
- `complete-undo` restores the task to its place.
- `complete-history` lists completed tasks.

## How to get to it (user POV)

- Web: choose the checkbox next to a task.
- Web: press `e` with a task selected.
- iOS: tap the checkbox next to a task.
- iOS: swipe a task to complete it.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk` and `Pay rent`.

- **Complete.** Planned: check `Buy milk` on the web. It animates out and Inbox shows only `Pay rent`. An undo option appears.
- **Undo.** Planned: choose undo. `Buy milk` returns to its original position.
- **History.** Planned: complete `Buy milk` again and open completed tasks. `Buy milk` is listed there.
- **iOS swipe.** Planned: swipe `Pay rent` in the simulator. It animates out of Inbox.
- **Proof.** Planned: record the check and undo on the web as motion proof, then reload and capture Inbox.

## Gotchas

- The undo option is temporary. Act on it before it disappears.
- A screenshot cannot prove the animation. Record motion proof.
- The checkbox must respond on the first frame. Treat a delay before the animation starts as a failure.
