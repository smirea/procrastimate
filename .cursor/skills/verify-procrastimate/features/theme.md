# Theme

The web client has a light and a dark theme. Stefan picks `System`, `Light`, or `Dark` from a segmented control in [Settings](./settings.md), a popover on desktop and a sheet on a phone. `System` is the default and follows the device's appearance live. The choice is saved on the device, and a reload paints the saved theme from the first frame with no flash of the other one. Switching crossfades the whole page. Under it, `Theme color` picks one of ten colors (`Frost`, a vibrant blue, by default), or any color from the `Custom` row under the swatches, which opens the platform's color picker; the accent, the text on accent fills, and the canvas glow follow it in both themes, adjusted until they stay readable. It is saved on the device too.

## Sub-features

- `theme-system` follows the device's light or dark appearance, including changes while the app is open.
- `theme-override` forces `Light` or `Dark` regardless of the device appearance.
- `theme-persist` keeps the choice across reloads on the same device. It is not part of the task data.
- `theme-first-paint` applies the saved theme before the app loads, so the page never shows the wrong theme.
- `theme-accent` recolors the accent from one of ten theme colors, saved on the device and painted from the first frame.
- `theme-accent-custom` recolors the accent from any color picked in the `Custom` row. It derives a readable accent for each theme, is saved on the device as `#rrggbb`, and paints from the first frame. Web and iOS derive the same values.
- `theme-contrast` keeps every text color at WCAG AA contrast in both themes.
- `theme-glass-fallback` turns Liquid Glass layers solid when the device asks for more contrast or less transparency.
- `theme-reduced-motion` makes popovers and other motion instant when the device asks for reduced motion.

## How to get to it (user POV)

- Web desktop: `Settings` at the bottom of the sidebar, then the `Theme` control.
- Web phone: tap `Open navigation`, then `Settings`, then the `Theme` control in the sheet.
- iOS: pick a theme in Settings, or change the simulator's appearance.

## Driving it with control-ui and the simulator

Preconditions:

- The baseline state. The theme key is absent from a fresh profile, so the control starts on `System`.
- Contrast proof: `bun test app-web/src/lib/theme-contrast.test.ts`.

- **System.** Emulate a dark color scheme, then a light one. `<html data-theme>` and the page canvas follow each change while `System` stays checked.
- **Override and persist.** With a dark device appearance, choose `Light`, then reload. The page stays light and `Light` is still checked. Repeat with `Dark` under a light appearance, then choose `System` and reload.
- **Theme color.** `Frost` starts checked and `--color-accent` reads `#0067bd`. Choose `Violet`: the accent turns `#823ee1` in light and `#b28dff` under a dark appearance. The arrow keys move the choice and focus (up and down move a row of five). Reload: the first frame already has the chosen `--accent`, and the swatch stays checked. Choosing `Frost` again removes `procrastimate-accent` from `localStorage`. Test: `System follows the device, Light or Dark overrides it, a theme color recolors the accent, and both survive a reload and paint the first frame` in `e2e/theme.e2e.ts`.
- **Custom color.** Fill the `Custom theme color` input (the native color well spread over the `Custom` row) with `#ffff00`. `--color-accent` reads `#6b6b00` in light and `#aeae00` under a dark appearance, no swatch is checked, and the row shows `#FFFF00`. Reload: the first frame already has `#aeae00`, from the rules cached in `procrastimate-accent-css`, and the input still holds `#ffff00`. Choosing `Teal` removes `<style id="custom-accent">` and the cached rules. Test: `a custom theme color derives a readable accent in each theme, survives a reload from the first frame, and a preset replaces it` in `e2e/theme.e2e.ts`. Same values on iOS: `bun run vectors` records `shared/accents.test.ts` into `shared/vectors/accents.json`, which `VectorTests` replays against `Accents.deriveAccent`.
- **Keyboard.** Focus the checked option and press the arrow keys. Selection and focus move together.
- **No flash.** Choose `Dark` and reload. When `<body>` is first parsed, before anything can paint or the app runs, `<html>` already has `data-theme="dark"`, a dark `color-scheme`, and a dark `theme-color` for the browser chrome.
- **Automated.** System following the device, Light and Dark overriding it, each choice surviving a reload, and the first frame after each reload are one test, with the theme color: `System follows the device, Light or Dark overrides it, a theme color recolors the accent, and both survive a reload and paint the first frame` in `e2e/theme.e2e.ts`.
- **Phone.** Open the drawer, tap `Settings`, choose `Light` under a dark appearance, and reload. The settings sheet still shows `Light` checked and each option is at least 44 px tall.
- **Contrast.** The unit test runs once per theme color in each theme, and for a 216-color grid of custom colors. It composites each text token over every surface it can sit on, including the warm and cool canvas glows, dense glass over blurred list text and the accent fill, the solid glass fallback, quick add chips such as the recurrence chip, and parsed phrase highlights, and fails below 4.5:1. Tests are in `app-web/src/lib/theme-contrast.test.ts`.
- **Solid glass.** Emulate `contrast: 'more'`. The sidebar loses its backdrop blur and paints the opaque `--glass-solid` color, in light and in dark.
- **Reduced motion.** Emulate `reducedMotion: 'reduce'`, open quick add, and open the date picker. The `Due date` popover has no running animation.
- **Both themes.** Every color with a light value also has a dark value. Test: `every literal light color has a dark value`.
- **iOS tokens.** The iOS colors are generated from `app-web/src/index.css` and `shared/accents.ts`, so the contrast checked here holds on iOS too. `bun run generate` writes them (`Palette` and each `AccentChoice`'s `name` and `base` in `app-ios/Sources/App/Generated/Tokens.swift`, and the `AccentColor` asset from `Frost`) before every iOS build, so they cannot go stale. The accent itself is derived on the device by `Accents.deriveAccent` in `Core`, which the `accents` vectors keep equal to the web's.
- **iOS.** `System` follows the simulator's appearance live, `Light` and `Dark` override it, the choice survives a relaunch under `procrastimate-theme` in `UserDefaults`, and a relaunch paints its first frame in the saved theme. `Theme color` in Settings is a grid of swatches (`Accent <name>` identifiers): a tap recolors the tab bar, quick add button, toggles, and sheet buttons at once and survives a relaunch under `procrastimate-accent`. Under it the `Accent Custom` row opens the system color picker; a pick shows its `#RRGGBB` in the row, checks the row's swatch, and survives a relaunch. Launch with `-procrastimate-accent '#ffff00'` to start on a custom color. The picker runs out of process, so XCUITest sees none of its buttons: tap it by coordinate. To see the live switch, change the simulator's appearance (`xcrun simctl ui booted appearance dark`). Glass turning solid under Increase Contrast or Reduce Transparency, and instant motion under Reduce Motion, come from the system settings, so check them by hand in the simulator's Accessibility settings.

## Gotchas

- The control renders only while Settings is open, so open it first, again after every reload.
- Playwright starts in a light color scheme. Call `page.emulateMedia({ colorScheme })` before checking `System`.
- The theme color lives under `procrastimate-accent`, and the default stores nothing. A custom color also writes `procrastimate-accent-css`, which only the pre-paint script reads.
- The theme lives under the `procrastimate-theme` key in `localStorage`, apart from the `procrastimate` task store. Clearing only the task store keeps the theme.
- Switching runs a view transition, so take screenshots after `document.getAnimations()` settle. View transition animations can reject when they end, so wait with `Promise.allSettled`.
- Blocking the app bundle with `page.route` does not isolate the HTML shell in WebKit, which can still serve the cached bundle. Snapshot at body parse instead.
