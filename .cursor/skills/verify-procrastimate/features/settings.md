# Settings

A `Settings` row with a gear sits at the bottom of the sidebar, which is also the bottom of the phone drawer. On desktop it opens a small glass popover above the row. On a phone it closes the drawer and opens a bottom sheet. Both hold the `Theme` switch, the `Theme color` swatches, one `Dictation` line (`Native` or `ElevenLabs`), `Quick add buttons`, one notifications line, `Import from Todoist`, `Delete all data`, `Sign out`, and the version line.

## Sub-features

- `settings-popover` opens the settings popover from the desktop sidebar and closes it with Escape or a click outside.
- `settings-sheet` opens the settings bottom sheet from the phone drawer and closes it with `Close settings` or a tap on the scrim.
- `settings-theme` holds the `Theme` switch and the `Theme color` swatches. See [Theme](./theme.md).
- `settings-dictation` holds `Dictation`: `Native` or `ElevenLabs`. `Native` is selected until changed, and the choice is kept across a reload. Offline voice still uses native. See [Ramble](./ramble.md). Ramble's `Smart` / `Commands` mode syncs with these settings but is toggled only in the Ramble drawer.
- `settings-quick-add-buttons` toggles which buttons quick add's chip row shows and orders them. The shown ones come first in row order and drag to reorder (a `Reorder <name>` handle, or the arrow keys on it, on the web, a long press on iOS); the hidden ones follow in the default order. It is synced, and the `+` menu's pins change the same list. See [Add a task](./add-task.md).
- `settings-notifications` is one line: `Notifications: On`, `Notifications: Off`, or `Notifications need permission`. The last one is a button. See [Push notifications](./push-notifications.md).
- `settings-delete` is `Delete all data`. Confirming wipes tasks, projects, and labels on this device and the server. See [Offline and sync](./offline-sync.md).
- `settings-import` holds `Import from Todoist`. It reads `Importing…` while the zip is read. See [Todoist import](./todoist-import.md).
- `settings-account` holds `Sign out`, which is instant. A refused web sign-out signs back in with the toast `Could not sign out`. On iOS it closes the Settings sheet and shows the sign-in screen. There is no `Delete account`.
- `settings-version` is the last line, `Version <commit count>.<yyyyMMdd>`, such as `Version 465.20261017`, the same on the web and iOS for one commit.

## How to get to it (user POV)

- Web desktop: `Settings` at the bottom of the sidebar.
- Web phone: tap `Open navigation`, then `Settings` at the bottom of the drawer.
- iOS: tap `Settings` in the Browse tab.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state.

- **Desktop popover.** Before opening, the page has no `Theme` radio group. Click `Settings`. The `Settings` dialog shows `Theme`, `Dictation`, a notifications line, `Import from Todoist`, and `Delete all data`. It does not show `Sync`. Choose `Dark`, then press Escape. The dialog closes and the page stays dark.
- **Dictation.** Open `Settings`. `Native` is checked. Choose `ElevenLabs`, close, and reload. `ElevenLabs` is still checked. Choose `Native` again.
- **Quick add buttons.** Open `Settings`. The `Quick add buttons` group shows `Date`, `Priority`, `Reminders`, and `Subtasks` pressed and `Repeat` and `Labels` not. Click `Labels`; it reads pressed and moves to the end of the shown rows. Drag the `Reorder Subtasks` handle above `Date`; open quick add and the row starts with the checklist. On iOS the section lists the same toggles plus `Location` and `Event`, and a long press on `Subtasks` drags it.
- **Phone sheet.** Open the drawer and tap `Settings`. The drawer closes and the `Settings` sheet docks to the bottom of the screen, with each theme option at least 44 px tall. `Close settings` dismisses it.
- **Automated.** A theme choice surviving a reload is in `e2e/theme.e2e.ts`. Dictation and the `Labels` quick add button reaching a new device before it writes its own: `a new device holds its settings changes until the account’s settings arrive, then writes only those` in `e2e/sync.e2e.ts`. The sheet's inset at 393 px and the dragged button order are manual.
- **Delete all.** Open `Settings`, choose `Delete all data`, and confirm `Delete every task, project, and label on this device and the server?`. The list is empty. `Cancel` leaves the list as it was. Driven in [Offline and sync](./offline-sync.md).
- **iOS.** `Settings` in Browse opens a sheet with the `Theme` segmented control (`System`, `Light`, `Dark`), the `Theme color` swatch grid, the `Dictation` segmented control (`Native`, `ElevenLabs`), a `Tabs` row (see `views-pinned-tabs` in task-views), the notifications line, `Import from Todoist`, `Delete all data`, `Sign out`, and `Version …` under it. There is no `Set up sync`. `Done` closes it. Tapping `Sign out` after a real email sign-in closes the sheet and shows the sign-in form.

## Gotchas

- The sidebar is hidden below 768 px, so the desktop popover only exists from 768 px up, and the sheet only below it.
- The popover renders only while open, so locate the `Theme` radio group after opening `Settings`.
