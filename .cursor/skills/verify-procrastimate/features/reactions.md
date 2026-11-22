# Reactions

People on a task react to it with one of five emoji: 👍 👎 👀 🛑 ❓. Each person holds at most one reaction per task, so picking another emoji replaces theirs and picking the same one takes it back. Reactions show at the right end of the row, one chip per emoji with a count when more than one person picked it, and the chip names who reacted. There are no custom reactions yet. See `docs/decisions/comments.md`.

## Sub-features

- `reactions-pick` reacts from the row: on the web, hover the row and then its smiley button for the picker; on touch, the row's long-press menu leads with the five emoji; on iOS, swipe the row left and tap `React`, or long-press and open `React`.
- `reactions-replace` picking another emoji replaces the user's reaction, and picking the current one takes it back.
- `reactions-chips` shows each emoji used on the task at the end of its row, with a count only above one, and the user's own chip outlined in the accent color. Completed rows show them too.
- `reactions-names` names who reacted, oldest first, with `You` for the user: a web tooltip on hovering a chip, or on iOS the menu a chip tap opens, which also picks or takes back that emoji.
- `reactions-shared` syncs reactions between the owner and guests in real time. An edit guest reacts, a view guest only sees them, and a public link shows none.

## How to get to it (user POV)

- Web desktop: hover a task row, then hover the smiley button beside Postpone and click an emoji. Click an existing chip to switch to or take back that emoji; hover it for the names.
- Web touch: long-press a row; the menu's first line is the five emoji.
- iOS: swipe a row left and tap `React`, then an emoji in the `React` dialog. Long-press a row and open `React` for the same five with a checkmark on the current one. Tap a chip for the names.

## Driving it with the browser and `./sim test`

Preconditions: two signed-in accounts on the web, one sharing a project to the other with `Can edit`; for iOS, launch with `PROCRASTIMATE_DEMO=sharing browse`.

- **Pick and replace (web).** As the owner, hover `Fix sink`, then `React to Fix sink`, and click `React 👍`: the row shows a `👍 You` chip. Click `React ❓` in the same picker: the chip becomes `❓ You`. Click it again: the chips go.
- **Shared (web).** The guest clicks the owner's `👍` chip: within a second the owner's row reads `👍 2`, and hovering it shows `You, Gus`. A guest who signed up after the owner's page loaded is named, not `Someone`.
- **Touch menu (web, 393 px).** Right-click or long-press `Fix sink`: the menu leads with five emoji, the current one highlighted, and picking one closes the menu and updates the chip.
- **iOS.** Garden's `Plant the tulip bulbs` shows `👍 2` (`reaction-Plant the tulip bulbs-👍`, labeled `Ann Lee, Claude`). Tap it: the menu is titled `Ann Lee, Claude` with `React 👍`, which makes it `👍 3`. Swipe `Buy a new hose` left, tap `React`, then `👀`: a `👀` chip joins Ann's `❓`. Long-press it, open `React`, and tap `❓`: the `👀` chip goes and `❓` reads `Ann Lee, You`.

## Gotchas

- The row id is `<task>:<author>`; the server refuses a reaction whose id names someone else, and anyone else's change to a reaction.
- Reactions outlive a deleted task so undo brings them back, like comments.
