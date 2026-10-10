# Complete a task

Complete a task lets Stefan check off a task with a short, satisfying animation, undo it right away, and find it later among completed tasks.

## Sub-features

- `complete-check` marks a task done and animates it out of the list.
- `complete-undo` restores the task to its place.
- `complete-history` lists completed tasks. Planned: not built yet.

## How to get to it (user POV)

- Web: choose the checkbox next to a task. Its ring is tinted by priority.
- Web: choose `Complete` in task details.
- Web on a phone: tap the checkbox. Its tap target is 44 px even though the ring is smaller.
- Web: press `e` with a task selected. Planned: task selection by keyboard is not built yet.
- iOS: tap the checkbox next to a task.
- iOS: swipe a task to complete it.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with Inbox seeded with `Buy milk` and `Pay rent` through quick add.
- Automated proof for the web steps: `bun run test:e2e -- e2e/tasks.e2e.ts -g "completing"`.

- **Complete.** Check `Buy milk` with the `Complete Buy milk` checkbox. The checkbox fills, the title strikes through, and the row slides out. Inbox shows only `Pay rent` and an `Undo` toast appears.
- **Undo.** Choose `Undo` in the toast. `Buy milk` returns above `Pay rent`.
- **Phone.** Seed `Buy milk` and `Pay rent`, then tap 8 px left of the `Complete Buy milk` ring. The row leaves and the `Undo` toast appears above the `Quick add` button. Tap `Undo`; `Buy milk` returns. Test: `a tap just outside the checkbox completes the task and undo restores it` in `bun run test:e2e -- e2e/mobile.e2e.ts`.
- **History.** Planned: complete `Buy milk` again and open completed tasks. `Buy milk` is listed there.
- **iOS swipe.** Planned: swipe `Pay rent` in the simulator. It animates out of Inbox.
- **Proof.** Planned: record the check and undo on the web as motion proof, then reload and capture Inbox.

## Gotchas

- The undo toast lasts five seconds. Act on it before it disappears.
- The row leaves about 260 ms after the click, once the check animation plays. Wait for the row to be gone, not for a fixed delay.
- A screenshot cannot prove the animation. Record motion proof.
- The checkbox must respond on the first frame. Treat a delay before the animation starts as a failure.
