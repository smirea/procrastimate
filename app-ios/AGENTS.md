# Stack

- Language: Swift 6, SwiftUI, iOS 27 only (the latest major, no fallbacks), iPhone first (iPad runs the same app). No macOS app.
- Keep dependencies at zero unless `docs/decisions/ios.md` says otherwise.
- Read `docs/decisions/ios.md` and `docs/ios-parity.md` before changing anything here. Each slice edits only its own parity rows and screen folders.

# Layout

- `Sources/Core`: Foundation-only logic (no SwiftUI, no UIKit), so it builds and tests on Linux. It never reads `Date()`, `TimeZone.current`, or `Calendar.current`; take an `AppClock`. Ports of `shared/` modules keep the TS names, one namespace per module (`Dates`, `Notifications`, `Subtasks`, `Views`, `Format`, `StoreRules`, `Snapshot`); the task type is `TaskItem`.
- `Sources/App`: the SwiftUI app. `Navigation/` holds `RootView`, `Route`, `Sheet`, and `Navigator`; `Screens/<Area>/` holds one file per screen; `Generated/Tokens.swift` is generated.
- `Tests/CoreTests`: Swift Testing for `Core`. `VectorTests` replays every case in `shared/vectors/*.json`; a ported function needs a handler there, and a module or function without one fails. There is no UI-test target.
- Search and import live in `CSV`, `Search`, `NameSearch`, and `Todoist`. Their offsets count UTF-16 code units like JavaScript strings (see `UTF16Text`), so convert with `String.Index(utf16Offset:in:)` in views.
- `Sources/Core/Generated/API.swift` is generated from the shared schemas by `bun run generate` at the repository root and is git-ignored. `./scripts/run`, `./scripts/archive`, and Core's `Generate` build phase (`scripts/generate`) write it before compiling, so Xcode needs `bun` and a root `bun install`. A synchronized folder lists its files before any phase runs, so the project excludes each generated Swift file from its folder and compiles it through an explicit reference to an output the phase declares; that is what lets a fresh clone build in one pass. A new generated Swift file needs the same three entries in `project.pbxproj`. Never edit it. Core's model types are typealiases of it in `Model.swift` and next to the code that uses them; add behavior in an extension. A new type both clients need is a Zod schema with an `id` in `shared/`, not a Swift declaration. Call the API through `APIClient` in `Sources/App/Sync` with an `API.Endpoints` descriptor.
- `Package.swift` declares only `Core` and `CoreTests`. `App.xcodeproj` builds `Core` as a static library and the app from synchronized folders, so adding files never edits `project.pbxproj`.

# Development

- Linux or any machine without Xcode: `./scripts/test` here generates `API.swift` and runs `swift test` for the `Core` tests. Plain `swift test` fails to compile until something has generated it. Install a toolchain with [swiftly](https://www.swift.org/install/linux/) if `swift` is missing. The app needs macOS; on Linux rely on the iOS workflow (`.github/workflows/ios.yml`).
- Colors come from `app-web/src/index.css`. `bun run generate` writes the git-ignored `Sources/App/Generated/Tokens.swift` and `Sources/App/Assets.xcassets/AccentColor.colorset` from it, as part of every build. The accent comes from the asset, so views need no `.tint`.
- Run `./scripts/run` to build, install, and launch the app, with automatic rebuild and relaunch after saving. Requires Bun and Xcode 27. Stop with Ctrl-C, or use `--no-watch` for one launch.
- Use `./scripts/run --targets` to list devices and iOS 27 simulators; `*` marks the effective default. Select with `-t simulator` or `-t "iPhone 17"` (also accepts a `--targets` index or an identifier). It opens Device Hub on Xcode 27 or Simulator.app on earlier Xcode versions.
- Selection precedence is `-t` / `--target`, then `SWIFT_RUN_DEFAULT_TARGET`, then a connected iOS device, booted simulator, or available simulator. Duplicate simulator names prefer a booted instance, then the newest runtime; use an identifier to select exactly.
- Physical devices need Xcode pairing, Developer Mode, and an unlocked screen. Configure automatic signing in Xcode, pass `--team`, or set `SWIFT_RUN_DEVELOPMENT_TEAM`.
- Open `App.xcodeproj` and use the shared `App` scheme to debug. Build output is in `DerivedData/device/build.log` or `DerivedData/simulator/build.log`. Use `xcrun simctl io <UDID> screenshot /tmp/app.png` to inspect the screen.

# Testing

- `./scripts/test` runs `Core` unit tests, including `VectorTests`. There is no XCUITest suite.

# Environment

- When nested in `monorepo-swift`, this directory is an env-manager target of the root `.env`. Edit values in the root `.env.local` for the selected environment (`dev` or `prod`) and run `env-manager up`, then `bun run env:ios`.
- Generated `Config/LocalSecrets.xcconfig` and `Config/Env.xcconfig` are ignored. `bun run env:ios` writes `Env.xcconfig`: Debug from env-manager `dev`, Release from `prod`. `Config/Base.xcconfig` includes both and pins Release to `https://procrastimate.stf.lol`. `Config/Info.plist` makes `API_URL` available to `AppEnvironment.apiURL`.
- Saving generated configuration also triggers the launcher watcher. Native settings are bundled into the app, so keep server credentials out of the Swift target.
