# Theme

The web client has a light and a dark theme. Stefan picks `System`, `Light`, or `Dark` from a segmented control in [Settings](./settings.md), a popover on desktop and a sheet on a phone. `System` is the default and follows the device's appearance live. The choice is saved on the device, and a reload paints the saved theme from the first frame with no flash of the other one. Switching crossfades the whole page.

## Sub-features

- `theme-system` follows the device's light or dark appearance, including changes while the app is open.
- `theme-override` forces `Light` or `Dark` regardless of the device appearance.
- `theme-persist` keeps the choice across reloads on the same device. It is not part of the task data.
- `theme-first-paint` applies the saved theme before the app loads, so the page never shows the wrong theme.
- `theme-contrast` keeps every text color at WCAG AA contrast in both themes.
- `theme-glass-fallback` turns Liquid Glass layers solid when the device asks for more contrast or less transparency.
- `theme-reduced-motion` makes popovers and other motion instant when the device asks for reduced motion.

## How to get to it (user POV)

- Web desktop: `Settings` at the bottom of the sidebar, then the `Theme` control.
- Web phone: tap `Open navigation`, then `Settings`, then the `Theme` control in the sheet.
- iOS: Planned: follow the system appearance with the same semantic colors.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state. The theme key is absent from a fresh profile, so the control starts on `System`.
- Automated proof for desktop steps: `bun run test:e2e -- e2e/theme.e2e.ts`. Phone steps live in `e2e/mobile.e2e.ts`.
- Contrast proof: `bun test app-web/src/lib/theme-contrast.test.ts`.

- **System.** Emulate a dark color scheme, then a light one. `<html data-theme>` and the page canvas follow each change while `System` stays checked. Test: `System is the default and follows the color scheme`.
- **Override and persist.** With a dark device appearance, choose `Light`, then reload. The page stays light and `Light` is still checked. Repeat with `Dark` under a light appearance, then choose `System` and reload. Test: `Light and Dark override the color scheme and persist across reloads`.
- **Keyboard.** Focus the checked option and press the arrow keys. Selection and focus move together. Test: `arrow keys move the theme selection`.
- **No flash.** Choose `Dark` and reload. When `<body>` is first parsed, before anything can paint or the app runs, `<html>` already has `data-theme="dark"`, a dark `color-scheme`, and a dark `theme-color` for the browser chrome. Test: `the saved theme applies before the app loads, so it never flashes`.
- **Phone.** Open the drawer, tap `Settings`, choose `Light` under a dark appearance, and reload. The settings sheet still shows `Light` checked and each option is at least 44 px tall. Tests: `the settings sheet switches the theme and keeps it across reloads` and `the saved theme applies before the app loads on a phone`.
- **Contrast.** The unit test composites each text token over every surface it can sit on, including the warm and cool canvas glows, dense glass over blurred list text and the accent fill, the solid glass fallback, quick add chips such as the recurrence chip, and parsed phrase highlights, and fails below 4.5:1. Tests: `light theme text meets WCAG AA contrast` and its dark sibling.
- **Solid glass.** Emulate `contrast: 'more'`. The sidebar loses its backdrop blur and paints the opaque `--glass-solid` color, in light and in dark. Test: `glass turns solid when the device asks for more contrast`.
- **Reduced motion.** Emulate `reducedMotion: 'reduce'`, open quick add, and open the date picker. The `Due date` popover has no running animation. Test: `popovers open without motion under reduced motion`.
- **Both themes.** Every color with a light value also has a dark value. Test: `every literal light color has a dark value`.
- **iOS tokens.** The iOS colors are generated from `app-web/src/index.css`, so the contrast checked here holds on iOS too. `bun scripts/tokens.ts --check` in `app-ios/` prints `Tokens.swift is fresh.`; the iOS workflow fails when it is stale.
- **iOS.** Planned: switch the simulator appearance and compare.

## Gotchas

- The control renders only while Settings is open, so open it first, again after every reload.
- Playwright starts in a light color scheme. Call `page.emulateMedia({ colorScheme })` before checking `System`.
- The theme lives under the `procrastimate-theme` key in `localStorage`, apart from the `procrastimate` task store. Clearing only the task store keeps the theme.
- Switching runs a view transition, so take screenshots after `document.getAnimations()` settle. View transition animations can reject when they end, so wait with `Promise.allSettled`.
- Blocking the app bundle with `page.route` does not isolate the HTML shell in WebKit, which can still serve the cached bundle. Snapshot at body parse instead.
