# Subtasks

Subtasks let Stefan break a task into steps, such as `Pack for trip` with `Passport`, `Charger`, and `Socks`. He adds, checks, and reorders them in task details, and the parent row shows how many are done. A subtask is a full task, so it can have its own date, reminders, and subtasks. Completing the parent completes them all, and a recurring parent starts each occurrence with every subtask open again.

## Sub-features

- `subtasks-add` adds a subtask from the `Add subtask` field in task details, parsing dates, repeats, priority, reminders, and `@` labels like quick add.
- `subtasks-quick-add` adds subtasks while capturing the parent in quick add (see `add-subtasks` in `add-task.md`).
- `subtasks-progress` shows a progress ring and `done/total` on the parent row and on nested subtask rows.
- `subtasks-rows` renders subtasks in task details with the list's task row: labels, notes, date, repeat, reminders, images, comment badge, and progress all show.
- `subtasks-check` toggles a subtask from its checkbox in the parent's details, with no toast. On iOS, swiping a subtask right toggles it too, and swiping left asks when to postpone it. On the web, the row's postpone button moves it.
- `subtasks-reorder` drags a subtask by its handle, by mouse or touch, or moves it with the arrow keys on the focused handle.
- `subtasks-nest` opens a subtask's own details in the same sheet, where it can have subtasks, with a back chip to the parent. Going back returns to where the parent was scrolled (test: `going back from a subtask returns to where the parent was scrolled` in `e2e/details-scroll.e2e.ts`). On iOS an edge swipe from the left also goes back, including for a subtask opened straight from Inbox or search.
- `subtasks-complete-parent` completes every open subtask under a completed task, with undo restoring each one as it was.
- `subtasks-recurring` reopens every subtask when a recurring parent moves to its next occurrence.
- `subtasks-search` finds a subtask in search by its own text, names its parent, and opens it with the back chip.
- `subtasks-explode` turns a task's subtasks into tasks of their own from the `Subtask actions` menu on the Subtasks heading in task details: `Keep titles`, `Start with “<parent>:”`, or `Inherit labels, date, and priority`. The parent stays, and the toast's `Undo` nests them again.
- `subtasks-dated` lists a dated subtask in the Inbox's day sections, marked with its parent's title. Projects and No date list only top-level tasks.

## How to get to it (user POV)

- Web: open a task and type in `Add subtask` under the notes, then press Enter.
- Web: in task details, tap a subtask's title to open it, and tap the back chip to return.
- Web: drag the six-dot handle at the end of a subtask row, or focus it and press up or down. Dragging to the edge of the task sheet scrolls it. Test: `dragging a subtask by its handle reorders it, and the arrow keys move it back` in `e2e/subtask-rows.e2e.ts`.
- Web: check off the parent from any list or with `Complete` in its details.
- Web and iOS: in quick add, tap the checklist chip and type subtask lines before saving.
- Web and iOS: in task details, tap the `…` button (`Subtask actions`) at the end of the Subtasks heading and pick one way under `Turn into tasks`.
- iOS: open a task and type in `Add subtask`, then press return. Tap a subtask to push its details, and drag the three-line handle to reorder.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with an empty Inbox. The suite pins the clock to Wednesday, October 14 2026, 10:00 UTC.
- Automated proof for the web steps: `bun run test:e2e -- e2e/subtasks.e2e.ts e2e/subtask-rows.e2e.ts e2e/details-scroll.e2e.ts`.

- **Add, check, and see progress.** Add `Pack for trip` and open it. Type `Passport`, `Charger`, and `Socks` into `Add subtask`, pressing Enter after each. Check `Complete Passport`; it fills and strikes through. The `Pack for trip` row shows `1/3` with a `1 of 3 subtasks done` ring, and Inbox has no `Passport` row. Reload; the row still reads `1 of 3 subtasks done` and `Passport` is still checked. Test: `subtasks are added, checked, and the parent row shows progress after a reload`.
- **Reorder.** With `Passport`, `Socks`, and `Charger`, drag `Reorder Charger` above `Passport`; the order reads `Charger`, `Passport`, `Socks`. Press ArrowDown on the focused handle; it reads `Passport`, `Charger`, `Socks` and the handle keeps focus. Test: `dragging a subtask by its handle reorders it, and the arrow keys move it back` in `e2e/subtask-rows.e2e.ts`.
- **Complete the parent.** With `Passport` done and `Charger` open, check `Complete Pack for trip` on its row. The row leaves. Choose `Undo`; the row returns with `1 of 2 subtasks done`, `Passport` is still checked and `Charger` is not. Test: `completing a parent completes its subtasks and undo restores each one`.
- **Recurring parent.** Add `Weekly review every fri`, add `Inbox zero` and `Plan week`, and check both; the row shows `2/2`. Check the row off; it reads `Oct 23` and `0 of 2 subtasks done`. Choose `Undo`; the row reads `Friday` and `2 of 2 subtasks done`. Test: `completing a recurring parent moves it to the next occurrence, resets its subtasks, and undo restores them`.
- **Hashtags stay text.** Create project `Home`, add `Pack for trip` with subtask `Charger`, open `Charger`, and rename it `Charger #Home`. Back in the parent, the subtask reads `Charger #Home`.
- **Nest and dated subtasks.** In `Pack for trip`, add `Charger` and `Buy adapter today`, and check `Charger`. Tap `Charger`; its details slide in with a `Back to Pack for trip` chip. Add `Cable`, then go back. `Charger` is unchecked again, because an open subtask cannot sit under a done one, and its row shows `0 of 1 subtasks done`. No date lists only `Pack for trip`. Inbox's `Today` section lists `Buy adapter` marked with its parent's title, `Pack for trip`. Test: `subtasks nest, open in place, and a dated subtask shows in Today under its parent`.
- **Search.** Add `Pack for trip` with subtask `Passport`, close it, press `/`, and type `passport`. The one result reads `Passport` marked `Subtask of Pack for trip`. Choose it; its details open with `Back to Pack for trip`.
- **Turn into tasks.** Add `Plan trip p2 today`, open it, and add `Book flights`, `Pack bag p1`, and `Renew passport`. Open `Subtask actions` and choose `Inherit labels, date, and priority`. The subtask list empties, the toast reads `Turned 3 subtasks into tasks`, and Inbox's Today lists `Book flights` and `Renew passport` at P2 and `Pack bag` at P1 next to `Plan trip`. `Undo` nests them again. With `Start with “Plan trip:”` the rows read `Plan trip: Book flights`. Test: `subtasks turned into tasks show as tasks on the other device, and undo nests them again` in `e2e/sync.e2e.ts`, plus the `exploding subtasks` unit tests in `shared/store.test.ts`.
- **Phone.** At 393 px, add `Pack for trip`, tap it, add `Passport`, `Charger`, and `Socks` with the return key, and tap `Complete Passport`. The `Reorder Socks` handle has a 44 px hit area. Drag it above `Passport`; the order reads `Socks`, `Passport`, `Charger`. Close the sheet; the row shows `1 of 3 subtasks done`.
- **Phone, automated.** At 393 px, add `Pack for trip tomorrow`, tap it, add `Passport`, `Charger`, and `Socks`, tap `Complete Passport`, and close; the row reads `1/3`, also after a reload. Test: `subtasks are added and checked by touch in the task sheet, and the row shows progress` in `e2e/phone.e2e.ts`. The drag by touch stays manual.
- **iOS.** In the simulator (`bun run start:ios -t simulator`), the same scenarios hold. `Add subtask` parses `Charger tomorrow p1` and keeps focus. Checking `Passport` selects it with no toast and the parent row reads `1 of 3 subtasks done`. Dragging `Reorder Socks` onto `Passport` reads `Socks`, `Passport`, `Charger`, with an impact haptic at pickup and drop. Tapping `Charger` pushes its details with `Back to Pack for trip`. Completing the parent cascades and `Undo` restores each subtask. A recurring parent reopens its subtasks. Inbox's `Today` section lists `Buy adapter` marked with `Pack for trip`. No XCUITest covers these; `swift test` runs the shared store rules through `VectorTests`.

## Gotchas

- The reorder handle only shows with two or more subtasks.
- A subtask title wraps onto as many lines as it needs in task details; it never truncates. The `Add subtask` field wraps too, growing to eight lines before it scrolls inside.
- Checking a subtask in its parent's details shows no toast. Uncheck it to undo.
- A done subtask hides its date and postpone action.
- On iOS, vertical drags over the subtask rows still scroll the details; the swipe actions only take sideways drags.
- On iOS a done subtask has only the right swipe (`Reopen`). Swiping it left leaves the row in place, and the next right swipe still shows `Reopen`. As in a list, an open row closes when you tap elsewhere in the details or scroll them, and opening one row's swipe closes any other.
- A subtask has no project picker. It always shares its root task's project.
- Playwright cannot synthesize a touch drag. Prove a real finger drag on a device or the iOS simulator.
