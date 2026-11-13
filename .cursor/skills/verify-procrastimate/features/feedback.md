# Give feedback

Feedback freezes the screen into an editor, in every build on both clients. Stefan taps a component on the frozen screenshot, writes what should change, and repeats for as many items as he needs. Share exports an annotated image, a JSON report naming each component's source file and line and the data it showed, or both in a ZIP. The `ProcrastiMate` share target posts the feedback as a task in a picked project, with the image and `feedback.json` attached, using the app's own session.

## Sub-features

- `shake-open` (iOS) drops an `Add Feedback` pill on a shake; tapping it within 5 s opens the editor over the current screen, with the whole scrolling list captured at full length.
- `click-open` (web) opens the editor on Alt+Meta+click, with the clicked element selected and the app never getting the click.
- `hold-open` (web) captures the screen at once when three fingers rest on it for 600 ms. A quicker three-finger tap, or fingers that slide, open nothing, and a finger that landed on a row first opens no row menu.
- `countdown-open` (web) is Settings' `Give feedback`: Settings closes, a `Feedback in 5` pill counts down, then the page is captured.
- `tap-select` selects the smallest tagged component or accessibility element under a tap, and shows its parent, its `file:line`, and its data under the screenshot.
- `export` shares the annotated image, the JSON report, or both in a ZIP. The JSON's `context` lists `Session`, `Sync`, `Navigation`, and `Store`.
- `post-to-procrastimate` adds a task named after the screen followed by `Feedback` to the picked project, with the image and `feedback.json` attached. The web posts to its own origin's API with the session cookie.
- `post-to-github` (Stefan's account only) is the Share menu's `GitHub Issue`: it files the feedback as an issue labeled `feedback` in `smirea/procrastimate`, opened by `smirea-ai`, and the toast `Sent to GitHub Issue` links to it. Any other account has no such entry, and the server refuses its post.
- `discard-prompt` asks before closing the editor with items never shared.

## How to get to it (user POV)

- iOS: shake the iPhone on any screen, then tap `Add Feedback`. In the simulator, use **Device › Shake**.
- Web: Option+Command+click anything. On a phone, hold three fingers on the screen, or open Settings and press `Give feedback`.

## Driving it with Playwright (web)

`app-web/e2e/feedback.e2e.ts` covers `click-open`, `tap-select`, `post-to-procrastimate`, `post-to-github`, `countdown-open`, and `hold-open`: an Alt+Meta+click on a row's title selects `Text "<title>"`, `Select parent` steps to `TaskRow`, and `Share`, `ProcrastiMate`, `Add` creates a task in the Inbox with an image and `feedback.json`. `__feedbackEngine.present()` opens the editor without a click, and `__feedbackEngine.lastExport` holds the last export's files.

The `phone` test in the same file holds three touch points through CDP's `Input.dispatchTouchEvent` in a `hasTouch` Chromium context: one on a row first, then all three. Playwright's WebKit has no multi-touch, so iOS Safari is checked by hand: on the phone, hold three fingers on any list for a moment and the editor opens over it.

## Driving it with agent-device and simctl (iOS)

Preconditions:

- The app built for the worktree's simulator with `./sim --no-watch`, ad hoc signed so the shared keychain group counts.
- For `post-to-procrastimate`, the worktree's server running with `bun run start:server`, an account from `POST /api/auth/sign-up/email`, a project from `POST /api/projects`, and the app signed in to that account.
- For a long list without a server, launch with `SIMCTL_CHILD_PROCRASTIMATE_RESET=1 SIMCTL_CHILD_PROCRASTIMATE_SIGNED_IN=1 SIMCTL_CHILD_PROCRASTIMATE_OFFLINE=1 SIMCTL_CHILD_PROCRASTIMATE_PERF=<path> SIMCTL_CHILD_PROCRASTIMATE_DEMO=bulk:300 xcrun simctl launch <udid> com.stefan.procrastimate`.

- **Shake.** `xcrun simctl notify_post <udid> com.apple.UIKit.SimulatorShake`, then press `Add Feedback`. After about 3 s on a long list, a snapshot shows `Close`, `Feedback`, `Feedback list, 0 items`, and the `Feedback text` field.
- **Tap select.** Press a point on a task row in the screenshot with a plain coordinate press (no `--settle`). The selection reads the row's combined button, with `Select parent, TaskRow` and `App/TaskRow.swift` with a line number, and the task's data starting `task: Task(id: …`.
- **Export.** Type a note, press `Add feedback`, then `Share` and `JSON`. Read `"$(xcrun simctl get_app_container <udid> com.stefan.procrastimate data)/tmp/feedback.json"`; its `context` has the four entries above. Replay its taps with Feedback's `skills/feedback-accessibility/scripts/taps.py`: on the seeded Inbox about a quarter of the grid falls through, all of it in the gaps between rows.
- **Post to ProcrastiMate.** `Share`, then `ProcrastiMate`. The sheet `Add to ProcrastiMate` lists `Inbox` and the account's projects. Pick one and press `Add`. `GET /api/view` lists the task in that project with two attachments, an image and `feedback.json`, and the project's screen in the app shows it with `2` beside the paperclip.

## Filing a GitHub issue (both clients)

A local run has no entry until the server names the signed-in account. Sign up, then restart the server with `FEEDBACK_GITHUB_TOKEN="$(gh auth token --user smirea-ai)" FEEDBACK_GITHUB_USER_ID=<the account's id from the sign-up response> bun src/index.ts` in `server/`. Share then lists `GitHub Issue` after `ProcrastiMate`; choosing it shows `Sent to GitHub Issue` and a real issue lands in `smirea/procrastimate`, so close it afterwards. A second account signed in to the same server lists no `GitHub Issue`. `app-web/e2e/feedback.e2e.ts` covers the web without GitHub: the suite's server names no account, so the entry is missing, and with `/api/feedback/github` and the post stubbed it posts `id`, `title`, `image`, and `report` with the session cookie. `server/src/feedback-issues.test.ts` covers the gate and the issue's body against a fake GitHub.

## Gotchas

- Only a coordinate press reaches the editor's canvas reliably. A snapshot or `--settle` between presses has stopped the canvas from receiving taps.
- Dismissing the system share sheet does not mark items shared, so `Close` then asks `Discard feedback?`.
- At a tab root the list hides its navigation bar, so the posted task is named `ProcrastiMate Feedback` rather than after the list.
- `post-to-procrastimate` needs a real sign-in, which writes the shared keychain session. `PROCRASTIMATE_SIGNED_IN=1` skips the session, so use the server path for this step.
