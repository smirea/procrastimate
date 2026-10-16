# procrastimate for iOS

SwiftUI app for iOS 27, iPhone first. The app needs Bun and Xcode 27; the `Core` logic also builds and tests on Linux.

## Test

From this folder:

```sh
./scripts/test                  # generates API.swift, then swift test: Core unit tests on macOS or Linux
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

`--targets` lists indexes, names, and identifiers; `-t` accepts any of them; `*` marks the default. Selection prefers a connected iOS device, then a booted simulator, then an available iOS 27 simulator.

Set `SWIFT_RUN_DEFAULT_TARGET` to choose a default; `-t` overrides it. For duplicate simulator names, use an identifier to select exactly. Install simulator runtimes in Xcode's settings.

## Device signing

Pair the device in Xcode, enable Developer Mode, and unlock it. Configure automatic signing in Xcode or pass your team:

```sh
./scripts/run --team YOUR_TEAM_ID
```

You can also set `SWIFT_RUN_DEVELOPMENT_TEAM`.

## Debug and build

Open `App.xcodeproj` and select the shared `App` scheme to debug. Build logs are in `DerivedData/<target>/build.log`, where `<target>` is `device` or `simulator`.

## Archive and upload to TestFlight

Create an App Store Connect API key (Users and Access, Integrations, Team Keys) with the Admin role, so export can use the existing Apple Distribution certificate and profile. The archive is unsigned and does not create a development certificate. Download its `AuthKey_<id>.p8` somewhere outside the repo, then:

```sh
export ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id> ASC_KEY_PATH=~/.appstoreconnect/AuthKey_<id>.p8
./scripts/archive                # archive Release and upload to App Store Connect
./scripts/archive --export-only  # write build/archive/export/App.ipa without uploading
```

Release builds always call `https://procrastimate.stf.lol`; Debug uses `API_URL` from the environment below. The build number defaults to the current UTC time as `year.MMdd.HHmmss` (`BUILD_NUMBER` overrides it), so each upload is higher than the last. GitHub Actions runs this script for TestFlight; the key values never go in the repo.

## Environment

The parent `.env` declares this folder as an env-manager target. Debug builds use env `dev` and Release builds use env `prod`:

```sh
bun run env:ios
```

That writes `Config/Env.xcconfig`. `Config/Base.xcconfig` includes it and pins Release to `https://procrastimate.stf.lol`. `Config/Info.plist` exposes `API_URL` through `AppEnvironment.apiURL`. Regeneration triggers a rebuild while the launcher is watching.

Native configuration is bundled into the app. Keep credentials in the server target. For a physical device, set `dev`'s `API_URL` to a reachable host and run `bun run env:ios` again; `127.0.0.1` refers to the device itself.
