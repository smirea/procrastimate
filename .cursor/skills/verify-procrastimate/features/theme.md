# Theme

The web client has a light and a dark theme. Stefan picks `System`, `Light`, or `Dark` from a segmented control at the bottom of the sidebar, which is also the bottom of the phone drawer. `System` is the default and follows the device's appearance live. The choice is saved on the device, and a reload paints the saved theme from the first frame with no flash of the other one. Switching crossfades the whole page.

## Sub-features

- `theme-system` follows the device's light or dark appearance, including changes while the app is open.
- `theme-override` forces `Light` or `Dark` regardless of the device appearance.
- `theme-persist` keeps the choice across reloads on the same device. It is not part of the task data.
- `theme-first-paint` applies the saved theme before the app loads, so the page never shows the wrong theme.
- `theme-contrast` keeps every text color at WCAG AA contrast in both themes.

## How to get to it (user POV)

- Web desktop: the `Theme` control at the bottom of the sidebar.
- Web phone: tap `Open navigation`, then the `Theme` control at the bottom of the drawer.
- iOS: Planned: follow the system appearance with the same semantic colors.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state. The theme key is absent from a fresh profile, so the control starts on `System`.
- Automated proof for desktop steps: `bun run test:e2e -- e2e/theme.e2e.ts`. Phone steps live in `e2e/mobile.e2e.ts`.
- Contrast proof: `bun test app-web/src/lib/theme-contrast.test.ts`.

- **System.** Emulate a dark color scheme, then a light one. `<html data-theme>` and the page canvas follow each change while `System` stays checked. Test: `System is the default and follows the color scheme`.
- **Override and persist.** With a dark device appearance, choose `Light`, then reload. The page stays light and `Light` is still checked. Repeat with `Dark` under a light appearance, then choose `System` and reload. Test: `Light and Dark override the color scheme and persist across reloads`.
- **Keyboard.** Focus the checked option and press the arrow keys. Selection and focus move together. Test: `arrow keys move the theme selection`.
- **No flash.** Choose `Dark`, block every request except the page itself, and reload. The bare HTML shell already has `data-theme="dark"` and a dark `color-scheme`. Test: `the saved theme applies before the app loads, so it never flashes`.
- **Phone.** Open the drawer, choose `Light` under a dark appearance, and reload. The drawer still shows `Light` checked and each option is at least 44 px tall. Tests: `the drawer theme switcher overrides the color scheme and persists across reloads` and `the saved theme applies before the app loads on a phone`.
- **Contrast.** The unit test composites each text token over every surface it can sit on, including the warm and cool canvas glows, and fails below 4.5:1. Test: `light theme text meets WCAG AA contrast` and its dark sibling.
- **iOS.** Planned: switch the simulator appearance and compare.

## Gotchas

- Playwright starts in a light color scheme. Call `page.emulateMedia({ colorScheme })` before checking `System`.
- The theme lives under the `procrastimate-theme` key in `localStorage`, apart from the `procrastimate` task store. Clearing only the task store keeps the theme.
- Switching runs a view transition, so take screenshots after `document.getAnimations()` settle.
