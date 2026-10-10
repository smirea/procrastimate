# Priority

Priority lets Stefan mark how urgent a task is with Todoist's four levels, from the picker or by typing a shortcut. `P1` is red, `P2` orange, `P3` blue, and `P4` is the unmarked default.

## Sub-features

- `priority-nl` parses `p1` to `p4`, `!!!` and `urgent` as `P1`, and `!!` and `important` as `P2`.
- `priority-picker` sets priority from the flag chip in quick add or task details.
- `priority-replace` replaces a typed shortcut when a level is picked.
- `priority-display` tints the task checkbox with the priority color.

## How to get to it (user POV)

- Web: type a shortcut in quick add or the task details title.
- Web: choose the flag chip in quick add or task details and pick a level.
- iOS: Planned: not built yet.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state, with an empty Inbox.
- Automated proof for every web step: `bun run test:e2e -- e2e/priority-reminders.e2e.ts` (the reminder tests in that file are covered by [Reminders](./reminders.md)).

- **Shortcuts.** In quick add, type `File taxes p2`, then repeat with `!!`, `!!!`, `urgent`, and `p3`. Each shortcut is highlighted, the chip reads the matching `Priority N`, and the saved task's checkbox takes that level's color. Tests: `"p2" in quick add sets priority 2` and its siblings.
- **Picker replaces text.** Type `File taxes p1`, open the `Priority 1` chip, and pick `Priority 3`. `p1` is removed from the input and the chip reads `Priority 3`. Test: `picking a priority in quick add replaces the typed one`.
- **Details.** Open a task and pick `Priority 1` from its flag chip. After a reload the chip still reads `Priority 1`. Test: `details edit fields as they change and persist across reload` in `e2e/tasks.e2e.ts`.
- **iOS.** Planned: set priority in the simulator.

## Gotchas

- A single `!` and `p5` are title text by design.
- Bangs attached to a word, like `Wow!!`, are title text.
- If two shortcuts appear, the last one wins.
