# Stack

- Language: Swift 6, SwiftUI, iOS 26 minimum, iPhone first (iPad runs the same app). No macOS app.
- Keep dependencies at zero unless `docs/decisions/ios.md` says otherwise.
- Read `docs/decisions/ios.md` and `docs/ios-parity.md` before changing anything here. Each slice edits only its own parity rows and screen folders.

# Layout

- `Sources/Core`: Foundation-only logic (no SwiftUI, no UIKit), so it builds and tests on Linux. It never reads `Date()`, `TimeZone.current`, or `Calendar.current`; take an `AppClock`.
- `Sources/App`: the SwiftUI app. `Navigation/` holds `RootView`, `Route`, `Sheet`, and `Navigator`; `Screens/<Area>/` holds one file per screen; `Theme/Tokens.swift` is generated.
- `Tests/CoreTests`: Swift Testing for `Core`. `Tests/AppUITests`: XCUITests, `<Area>ParityTests.swift` with `test_<parity_id>`, built on `ParityTestCase`.
- `Package.swift` declares only `Core` and `CoreTests`. `App.xcodeproj` builds `Core` as a static library, the app, and the UI tests from synchronized folders, so adding files never edits `project.pbxproj`.

# Development

- Linux or any machine without Xcode: `swift test` here runs the `Core` tests. Install a toolchain with [swiftly](https://www.swift.org/install/linux/) if `swift` is missing. The app and UI tests need macOS; on Linux rely on the iOS workflow (`.github/workflows/ios.yml`).
- Colors come from `app-web/src/index.css`. After changing it, run `bun scripts/tokens.ts` here and commit `Sources/App/Theme/Tokens.swift` and `Sources/App/Assets.xcassets/AccentColor.colorset`; CI runs `--check`. The accent comes from the asset, so views need no `.tint`.
- Run `./scripts/run` to build, install, and launch the app, with automatic rebuild and relaunch after saving. Requires Bun and Xcode 26. Stop with Ctrl-C, or use `--no-watch` for one launch.
- Use `./scripts/run --targets` to list devices and iOS 26 simulators; `*` marks the effective default. Select with `-t simulator` or `-t "iPhone 17"` (also accepts an identifier). It opens Device Hub on Xcode 27 or Simulator.app on earlier Xcode versions.
- Selection precedence is `-t` / `--target`, then `SWIFT_RUN_DEFAULT_TARGET`, then a connected iOS device, booted simulator, or available simulator. Duplicate simulator names prefer a booted instance, then the newest runtime; use an identifier to select exactly.
- Physical devices need Xcode pairing, Developer Mode, and an unlocked screen. Configure automatic signing in Xcode, pass `--team`, or set `SWIFT_RUN_DEVELOPMENT_TEAM`.
- Open `App.xcodeproj` and use the shared `App` scheme to debug or run the UI tests. Build output is in `DerivedData/device/build.log` or `DerivedData/simulator/build.log`. Use `xcrun simctl io <UDID> screenshot /tmp/app.png` to inspect the screen.

# Testing

- UI tests call `launch()`, which sets the DEBUG launch environment: `PROCRASTIMATE_NOW=2026-10-14T10:00:00Z`, `PROCRASTIMATE_TZ=UTC`, and `PROCRASTIMATE_RESET=1` (empty store and preferences). Release builds ignore it.
- `snap("<parity-id>")` attaches a screenshot; CI exports it as `<parity-id>.png` in the `ios-parity` artifact. The paired Playwright test in `app-web/e2e/parity/` saves the same name, and the `parity-report` artifact shows both side by side.
- Find elements by the same accessible names the web uses, so both sides assert the same handles.

# Environment

- When nested in `monorepo-swift`, this directory is an env-manager target of the root `.env`. Edit local values only in the root `.env.local` and run `env-manager gen --local` from either directory.
- Generated `Config/LocalSecrets.xcconfig` is ignored. `Config/Base.xcconfig` includes it when present for Debug and Release; `Config/Info.plist` makes `API_URL` available to `AppEnvironment.apiURL`.
- Saving generated configuration also triggers the launcher watcher. Native settings are bundled into the app, so keep server credentials out of the Swift target.
