# Settings

A `Settings` row with a gear sits at the bottom of the sidebar, which is also the bottom of the phone drawer. On desktop it opens a small glass popover above the row. On a phone it closes the drawer and opens a bottom sheet. Both hold the `Theme` switch, one `Dictation` line (`Native` or `ElevenLabs`), `Quick add buttons`, one notifications line, `Import from Todoist`, and `Delete all data`.

## Sub-features

- `settings-popover` opens the settings popover from the desktop sidebar and closes it with Escape or a click outside.
- `settings-sheet` opens the settings bottom sheet from the phone drawer and closes it with `Close settings` or a tap on the scrim.
- `settings-theme` holds the `Theme` switch. See [Theme](./theme.md).
- `settings-dictation` holds `Dictation`: `Native` or `ElevenLabs`. `Native` is selected until changed, and the choice is kept across a reload. Offline voice still uses native. See [Ramble](./ramble.md).
- `settings-quick-add-buttons` toggles which buttons quick add's chip row shows. It is synced, and the `+` menu's pins change the same list. See [Add a task](./add-task.md).
- `settings-notifications` is one line: `Notifications: On`, `Notifications: Off`, or `Notifications need permission`. The last one is a button. See [Push notifications](./push-notifications.md).
- `settings-delete` is `Delete all data`. Confirming wipes tasks, projects, and labels on this device and the server. See [Offline and sync](./offline-sync.md).
- `settings-import` holds `Import from Todoist`. It reads `Importing…` while the zip is read. See [Todoist import](./todoist-import.md).
- `settings-account` holds `Sign out`, which is instant, and `Delete account`, which reads `Deleting…` until the server confirms. A refused web sign-out signs back in with the toast `Could not sign out`. Test: `sign out is instant, and a refused one signs back in with a toast` in `e2e/optimistic.e2e.ts`.

## How to get to it (user POV)

- Web desktop: `Settings` at the bottom of the sidebar.
- Web phone: tap `Open navigation`, then `Settings` at the bottom of the drawer.
- iOS: tap `Settings` in the Browse tab.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state.
- Automated proof for desktop steps: `bun run test:e2e -- e2e/settings.e2e.ts`. Phone steps live in `e2e/mobile.e2e.ts`.

- **Desktop popover.** Before opening, the page has no `Theme` radio group. Click `Settings`. The `Settings` dialog shows `Theme`, `Dictation`, a notifications line, `Import from Todoist`, and `Delete all data`. It does not show `Sync`. Choose `Dark`, then press Escape. The dialog closes and the page stays dark. Test: `the settings gear opens a popover that holds the theme switch`.
- **Dictation.** Open `Settings`. `Native` is checked. Choose `ElevenLabs`, close, and reload. `ElevenLabs` is still checked. Choose `Native` again. Test: `dictation is one line, native until changed, and kept across a reload`. The phone pair is `settings › settings-dictation`.
- **Quick add buttons.** Open `Settings`. The `Quick add buttons` group shows `Date`, `Priority`, `Reminders`, and `Subtasks` pressed and `Repeat` and `Labels` not. Click `Labels`; it reads pressed. Open quick add; a `Labels` chip sits in the row. On iOS the section lists the same toggles plus `Location` and `Event`. No automated spec; drive it with Playwright and a throwaway XCUITest.
- **Phone sheet.** Open the drawer and tap `Settings`. The drawer closes and the `Settings` sheet docks to the bottom of the screen, with each theme option at least 44 px tall. `Close settings` dismisses it. Test: `the settings sheet switches the theme and keeps it across reloads`.
- **Delete all.** Open `Settings`, choose `Delete all data`, and confirm `Delete every task, project, and label on this device and the server?`. The list is empty. `Cancel` leaves the list as it was. Driven in [Offline and sync](./offline-sync.md).
- **iOS.** `Settings` in Browse opens a sheet with the `Theme` segmented control (`System`, `Light`, `Dark`), the `Dictation` segmented control (`Native`, `ElevenLabs`), the notifications line, `Import from Todoist`, and `Delete all data`. There is no `Set up sync`. `Done` closes it. Tests: `SettingsParityTests` (`test_settings_sheet`, `test_settings_theme`, `test_settings_dictation`), paired with `e2e/parity/settings.e2e.ts`. Run each pair with the iOS workflow (`xcodebuild test` on an iPhone 16 simulator) and `bun run test:e2e --project=parity`; both sides save `<parity-id>.png`.

## Gotchas

- The sidebar is hidden below 768 px, so the desktop popover only exists from 768 px up, and the sheet only below it.
- The popover renders only while open, so locate the `Theme` radio group after opening `Settings`.
