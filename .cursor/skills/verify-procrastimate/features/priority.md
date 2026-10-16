# Priority

Priority lets Stefan mark how urgent a task is with Todoist's four levels, from the picker or by typing a shortcut. `P1` is red, `P2` orange, `P3` blue, and `P4` is the unmarked default.

## Sub-features

- `priority-nl` parses `p1` to `p4`, `!!!` and `urgent` as `P1`, and `!!` and `important` as `P2`.
- `priority-picker` sets priority from the icon-only flag in quick add or the `Priority` chip in task details.
- `priority-replace` replaces a typed shortcut when a level is picked.
- `priority-display` tints the task checkbox with the priority color.

## How to get to it (user POV)

- Web: type a shortcut in quick add or the task details title.
- Web: choose the flag chip in quick add or task details and pick a level.
- iOS: type a priority or use the flag chip in quick add or task details.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state, with an empty Inbox.

- **Shortcuts.** In quick add, type `File taxes p2`, then repeat with `!!`, `!!!`, `urgent`, and `p3`. Each shortcut is highlighted, the flag's accessible name reads the matching `Priority N`, and the saved task's checkbox takes that level's color.
- **Picker replaces text.** Type `File taxes p1`, open the red `Priority 1` flag, and pick `Priority 3`. `p1` is removed from the input and the flag turns blue. Picking `Priority 4` instead leaves a plain gray outline flag.
- **Details.** Open a task and pick `Priority 1` from its flag chip. After a reload the chip still reads `Priority 1`.
- **iOS.** `p1`, `!!`, and `urgent` set the level, the flag menu picks one and removes the typed phrase, and each checkbox reports its level as its accessibility value. Drive it with `bun run start:ios -t simulator`. The same flag menu sets the level in task details.

## Gotchas

- A single `!` and `p5` are title text by design.
- Bangs attached to a word, like `Wow!!`, are title text.
- If two shortcuts appear, the last one wins.
