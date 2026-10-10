# Settings

A `Settings` row with a gear sits at the bottom of the sidebar, which is also the bottom of the phone drawer. On desktop it opens a small glass popover above the row. On a phone it closes the drawer and opens a bottom sheet. Both hold the `Theme` switch and `Import from Todoist`.

## Sub-features

- `settings-popover` opens the settings popover from the desktop sidebar and closes it with Escape or a click outside.
- `settings-sheet` opens the settings bottom sheet from the phone drawer and closes it with `Close settings` or a tap on the scrim.
- `settings-theme` holds the `Theme` switch. See [Theme](./theme.md).
- `settings-import` holds `Import from Todoist`. See [Todoist import](./todoist-import.md).

## How to get to it (user POV)

- Web desktop: `Settings` at the bottom of the sidebar.
- Web phone: tap `Open navigation`, then `Settings` at the bottom of the drawer.
- iOS: Planned: a settings screen with the same controls.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state.
- Automated proof for desktop steps: `bun run test:e2e -- e2e/settings.e2e.ts`. Phone steps live in `e2e/mobile.e2e.ts`.

- **Desktop popover.** Before opening, the page has no `Theme` radio group. Click `Settings`. The `Settings` dialog shows `Theme` and `Import from Todoist`. Choose `Dark`, then press Escape. The dialog closes and the page stays dark. Test: `the settings gear opens a popover that holds the theme switch`.
- **Phone sheet.** Open the drawer and tap `Settings`. The drawer closes and the `Settings` sheet docks to the bottom of the screen, with each theme option at least 44 px tall. `Close settings` dismisses it. Test: `the settings sheet switches the theme and keeps it across reloads`.
- **iOS.** Planned: open the settings screen and compare.

## Gotchas

- The sidebar is hidden below 768 px, so the desktop popover only exists from 768 px up, and the sheet only below it.
- The popover renders only while open, so locate the `Theme` radio group after opening `Settings`.
