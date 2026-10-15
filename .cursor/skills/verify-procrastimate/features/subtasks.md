# Subtasks

Subtasks let Stefan break a task into steps, such as `Pack for trip` with `Passport`, `Charger`, and `Socks`. He adds, checks, and reorders them in task details, and the parent row shows how many are done. A subtask is a full task, so it can have its own date, reminders, and subtasks. Completing the parent completes them all, and a recurring parent starts each occurrence with every subtask open again.

## Sub-features

- `subtasks-add` adds a subtask from the `Add subtask` field in task details, parsing dates, repeats, priority, reminders, and `@` labels like quick add.
- `subtasks-progress` shows a progress ring and `done/total` on the parent row and on nested subtask rows.
- `subtasks-check` toggles a subtask from its checkbox in the parent's details, with no toast.
- `subtasks-reorder` drags a subtask by its handle, by mouse or touch, or moves it with the arrow keys on the focused handle.
- `subtasks-nest` opens a subtask's own details in the same sheet, where it can have subtasks, with a back chip to the parent. On iOS an edge swipe from the left also goes back, including for a subtask opened straight from Inbox or search.
- `subtasks-complete-parent` completes every open subtask under a completed task, with undo restoring each one as it was.
- `subtasks-recurring` reopens every subtask when a recurring parent moves to its next occurrence.
- `subtasks-search` finds a subtask in search by its own text, names its parent, and opens it with the back chip.
- `subtasks-dated` lists a dated subtask in the Inbox's day sections, marked with its parent's title. Projects and No date list only top-level tasks.

## How to get to it (user POV)

- Web: open a task and type in `Add subtask` under the notes, then press Enter.
- Web: in task details, tap a subtask's title to open it, and tap the back chip to return.
- Web: drag the six-dot handle at the end of a subtask row, or focus it and press up or down.
- Web: check off the parent from any list or with `Complete` in its details.
- iOS: open a task and type in `Add subtask`, then press return. Tap a subtask to push its details, and drag the three-line handle to reorder.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for the web steps: `bun run test:e2e -- e2e/subtasks.e2e.ts`, and the phone test in `e2e/mobile.e2e.ts`.

- **Add, check, and see progress.** Add `Pack for trip` and open it. Type `Passport`, `Charger`, and `Socks` into `Add subtask`, pressing Enter after each. Check `Complete Passport`; it fills and strikes through. The `Pack for trip` row shows `1/3` with a `1 of 3 subtasks done` ring, and Inbox has no `Passport` row. Test: `subtasks are added, checked, and reordered in task details and the parent row shows progress`.
- **Reorder.** Drag `Reorder Socks` above `Passport`; the order reads `Socks`, `Passport`, `Charger`. Focus `Reorder Charger` and press ArrowUp; it reads `Socks`, `Charger`, `Passport` and the handle keeps focus. Reload; the order and `1/3` remain. Same test.
- **Complete the parent.** With `Passport` done and `Charger` open, check `Complete Pack for trip` on its row. The row leaves. Choose `Undo`; the row returns with `1 of 2 subtasks done`, `Passport` is still checked and `Charger` is not. Test: `completing a parent completes its subtasks and undo restores each one`.
- **Recurring parent.** Add `Weekly review every fri`, add `Inbox zero` and `Plan week`, and check both; the row shows `2/2`. Check the row off; it reads `Oct 23` and `0 of 2 subtasks done`. Open it, type the note `Bring coffee`, close it, and choose `Undo`; the row reads `Friday` and `2 of 2 subtasks done` and keeps the note. Test: `completing a recurring parent moves it to the next occurrence and resets its subtasks`.
- **Hashtags stay text.** Create project `Home`, add `Pack for trip` with subtask `Charger`, open `Charger`, and rename it `Charger #Home`. Back in the parent, the subtask reads `Charger #Home`. Test: `a subtask title keeps a project hashtag as text`.
- **Nest and dated subtasks.** In `Pack for trip`, add `Charger` and `Buy adapter today`, and check `Charger`. Tap `Charger`; its details slide in with a `Back to Pack for trip` chip. Add `Cable`, then go back. `Charger` is unchecked again, because an open subtask cannot sit under a done one, and its row shows `0 of 1 subtasks done`. No date lists only `Pack for trip`. Its `Today` section lists `Buy adapter` marked `Subtask of Pack for trip`. Test: `subtasks nest, open in place, and a dated subtask shows in Today under its parent`.
- **Search.** Add `Pack for trip` with subtask `Passport`, close it, press `/`, and type `passport`. The one result reads `Passport` marked `Subtask of Pack for trip`. Choose it; its details open with `Back to Pack for trip`. Test: `search finds a subtask, shows its parent, and opens it with a way back`.
- **Phone.** Add `Pack for trip`, tap it, add three subtasks with the return key, and tap `Complete Passport`. The `Reorder Socks` handle has a 44 px hit area. Drag it above `Passport`; the order reads `Socks`, `Passport`, `Charger`. Close the sheet; the row shows `1 of 3 subtasks done`. Test: `subtasks are added, checked, and dragged into order by touch in the task sheet` in `bun run test:e2e -- e2e/mobile.e2e.ts`. The suite saves `app-web/test-results/mobile/subtasks-details.png`.
- **iOS.** The same scenarios run in the simulator: `Add subtask` parses `Charger tomorrow p1` and keeps focus, checking `Passport` selects it with no toast and the parent row reads `1 of 3 subtasks done`, dragging `Reorder Socks` onto `Passport` reads `Socks`, `Passport`, `Charger` with an impact haptic at pickup and drop, tapping `Charger` pushes its details with `Back to Pack for trip`, completing the parent cascades and `Undo` restores each subtask, a recurring parent reopens its subtasks, and Inbox's `Today` section lists `Buy adapter` marked `Subtask of Pack for trip`. Tests: `SubtasksParityTests` (`test_subtasks_add`, `test_subtasks_progress`, `test_subtasks_check`, `test_subtasks_reorder`, `test_subtasks_nest`, `test_subtasks_complete_parent`, `test_subtasks_recurring`, `test_subtasks_dated`), paired with `e2e/parity/subtasks.e2e.ts`. Run each pair with the iOS workflow (`xcodebuild test` on an iPhone 16 simulator) and `bun run test:e2e --project=parity`; both sides save `<parity-id>.png`.

## Gotchas

- The reorder handle only shows with two or more subtasks.
- A subtask title wraps onto as many lines as it needs in task details; it never truncates.
- Checking a subtask in its parent's details shows no toast. Uncheck it to undo.
- A subtask has no project picker. It always shares its root task's project.
- Playwright's mobile drag uses mouse events on the WebKit iPhone profile, since Playwright cannot synthesize a touch drag. Prove a real finger drag on a device or the iOS simulator.
