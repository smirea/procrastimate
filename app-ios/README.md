# procrastimate for iOS

SwiftUI app for iOS 26+, iPhone first. The app needs Bun and Xcode 26 or newer; the `Core` logic also builds and tests on Linux.

## Test

From this folder:

```sh
swift test                      # Core unit tests, on macOS or Linux
bun scripts/tokens.ts --check   # generated colors match app-web/src/index.css
```

UI tests run from Xcode's `App` scheme or with:

```sh
xcodebuild test -project App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 16'
```

CI runs all of these in `.github/workflows/ios.yml`, plus the paired web tests, and uploads a side-by-side `parity-report`.

## Run

```sh
./scripts/run
```

The launcher selects a target and watches for changes. Edit `Sources` to rebuild and relaunch. Stop with Ctrl-C; use `--no-watch` for a single launch. Build errors leave the watcher running.

## Choose a target

```sh
./scripts/run --targets
./scripts/run -t simulator
./scripts/run -t "iPhone 17"
```

`--targets` lists names and identifiers; `*` marks the default. Selection prefers a connected iOS device, then a booted simulator, then an available iOS 26 simulator.

Set `SWIFT_RUN_DEFAULT_TARGET` to choose a default; `-t` overrides it. For duplicate simulator names, use an identifier to select exactly. Install simulator runtimes in Xcode's settings.

## Device signing

Pair the device in Xcode, enable Developer Mode, and unlock it. Configure automatic signing in Xcode or pass your team:

```sh
./scripts/run --team YOUR_TEAM_ID
```

You can also set `SWIFT_RUN_DEVELOPMENT_TEAM`.

## Debug and build

Open `App.xcodeproj` and select the shared `App` scheme to debug. Build logs are in `DerivedData/<target>/build.log`, where `<target>` is `device` or `simulator`.

## Environment

The parent `.env` declares this folder as an env-manager target. Edit local values in the parent `.env.local`, then regenerate from here or the repo root:

```sh
env-manager gen --local
```

This creates `Config/LocalSecrets.xcconfig`. `Config/Base.xcconfig` includes it, and `Config/Info.plist` exposes `API_URL` through `AppEnvironment.apiURL`. Regeneration triggers a rebuild while the launcher is watching.

Native configuration is bundled into the app. Keep credentials in the server target. For physical devices, set `API_URL` to a reachable API host; `127.0.0.1` refers to the device itself.
