# Give feedback

Feedback freezes the screen into an editor, in every build on both clients. Stefan taps a component on the frozen screenshot, writes what should change, and repeats for as many items as he needs. Share exports an annotated image, a JSON report naming each component's source file and line and the data it showed, or both in a ZIP. The `ProcrastiMate` share target posts the feedback as a task in a picked project, with the image and `feedback.json` attached, using the app's own session.

## Sub-features

- `shake-open` (iOS) drops an `Add Feedback` pill on a shake; tapping it within 5 s opens the editor over the current screen, with the whole scrolling list captured at full length.
- `click-open` (web) opens the editor on Alt+Meta+click, with the clicked element selected and the app never getting the click.
- `hold-open` (web) is the package's three-finger hold: 100 ms in, a capsule grows at the top center, and at 700 ms the screen is captured and the editor opens. A quicker three-finger tap, or fingers that slide, open nothing, and a finger that landed on a row first opens no row menu.
- `countdown-open` (web) is Settings' `Give feedback`: Settings closes, a `Feedback in 5` pill counts down, then the page is captured.
- `tap-select` selects the smallest tagged component or accessibility element under a tap, and shows its parent, its `file:line`, and its data under the screenshot.
- `export` shares the annotated image, the JSON report, or both in a ZIP. The JSON's `context` lists `Session`, `Sync`, `Navigation`, and `Store`.
- `post-to-procrastimate` adds a task named after the screen followed by `Feedback` to the picked project, with the image and `feedback.json` attached. The web posts to its own origin's API with the session cookie.
- `post-from-external-site` (web) opens `/feedback?nonce=…` as a popup from another origin's `@stefan.inc/feedback-engine` editor, receives the draft via `postMessage`, lists the signed-in user's own and edit-shared projects via `GET /api/feedback/projects` (showing sign-in first if signed out, and allowing account switching), uploads attachments and creates the task as that user (into the shared project's space when shared), posts `feedback:posted` back to the opener, and closes.
- `post-failure` (iOS) shows a red toast, `Couldn't add to ProcrastiMate` with the reason under it, when a post cannot be sent. It stays until tapped, and the tap opens a sheet with the message, `Copy Error`, the details open, and `Retry`. On the web the `Add to ProcrastiMate` sheet stays open and shows the failure itself.
- `post-to-github` (Stefan's account only) is the Share menu's `GitHub Issue`: it files the feedback as an issue labeled `feedback` in `smirea/procrastimate`, opened by `smirea-ai`, and the toast `Sent to GitHub Issue` links to it. Any other account has no such entry, and the server refuses its post.
- `discard-prompt` asks before closing the editor with items never shared.

## How to get to it (user POV)

- iOS: shake the iPhone on any screen, then tap `Add Feedback`. In the simulator, use **Device › Shake**.
- Web: Option+Command+click anything. On a phone, hold three fingers on the screen, or open Settings and press `Give feedback`.

`__feedbackEngine.present()` opens the editor without a click, and `__feedbackEngine.lastExport` holds the last export's files.

On a phone, hold three fingers on any list for a moment and the editor opens over it.

## Driving it with agent-device and simctl (iOS)

Preconditions:

- The app built for the worktree's simulator with `./sim --no-watch`, ad hoc signed so the shared keychain group counts.
- For `post-to-procrastimate`, the worktree's server running with `bun run start:server`, an account from `POST /api/auth/sign-up/email`, a project from `POST /api/projects`, and the app signed in to that account.
- For a long list without a server, launch with `SIMCTL_CHILD_PROCRASTIMATE_RESET=1 SIMCTL_CHILD_PROCRASTIMATE_SIGNED_IN=1 SIMCTL_CHILD_PROCRASTIMATE_OFFLINE=1 SIMCTL_CHILD_PROCRASTIMATE_PERF=<path> SIMCTL_CHILD_PROCRASTIMATE_DEMO=bulk:300 xcrun simctl launch <udid> com.stefan.procrastimate`.

- **Shake.** `xcrun simctl notify_post <udid> com.apple.UIKit.SimulatorShake`, then press `Add Feedback`. After about 3 s on a long list, a snapshot shows `Close`, `Feedback`, `Feedback list, 0 items`, and the `Feedback text` field.
- **Tap select.** Press a point on a task row in the screenshot with a plain coordinate press (no `--settle`). The selection reads the row's combined button, with `Select parent, TaskRow` and `App/TaskRow.swift` with a line number, and the task's data starting `task: Task(id: …`.
- **Export.** Type a note, press `Add feedback`, then `Share` and `JSON`. Read `"$(xcrun simctl get_app_container <udid> com.stefan.procrastimate data)/tmp/feedback.json"`; its `context` has the four entries above. Replay its taps with Feedback's `skills/feedback-accessibility/scripts/taps.py`: on the seeded Inbox about a quarter of the grid falls through, all of it in the gaps between rows.
- **Post to ProcrastiMate.** `Share`, then `ProcrastiMate`. The sheet `Add to ProcrastiMate` lists `Inbox` and the account's projects. Pick one and press `Add`. `GET /api/view` lists the task in that project with two attachments, an image and `feedback.json`, and the project's screen in the app shows it with `2` beside the paperclip.
- **Post failure.** Make the server refuse uploads for the run: add `if (request.method === 'PUT') return errorResponse('BAD_REQUEST', 'Refused');` after the grant check in `imagesRoute` (`server/src/image-bytes.ts`), which `bun run start:server` reloads. Post as above. The red toast is still there after 8 s; press it at its center, about `200 154`. The sheet `ProcrastiMate` shows the message, `Copy Error`, and `Details` open with `Status: 400`; `agent-device clipboard read` after `Copy Error` prints all of it. Remove the line, press `Retry`, and the toast `Added to Inbox in ProcrastiMate` follows.

## Filing a GitHub issue (both clients)

A local run has no entry until the server names the signed-in account. Sign up, then restart the server with `FEEDBACK_GITHUB_TOKEN="$(gh auth token --user smirea-ai)" OWNER_USER_ID=<the account's id from the sign-up response> bun src/index.ts` in `server/`. Share then lists `GitHub Issue` after `ProcrastiMate`; choosing it shows `Sent to GitHub Issue` and a real issue lands in `smirea/procrastimate`, so close it afterwards. A second account signed in to the same server lists no `GitHub Issue`. `server/src/feedback-issues.test.ts` covers the gate and the issue's body against a fake GitHub.

## Gotchas

- agent-device refuses to press `Add Feedback` by label, calling it covered by the navigation bar. Press the pill at `201 94` about a second after the shake, then check the snapshot starts with `Close` and `Feedback`: a press that misses lands in the app instead.
- A task posted to a project deleted after the sheet loaded lands in the Inbox, so that does not make a post fail.
- Only a coordinate press reaches the editor's canvas reliably. A snapshot or `--settle` between presses has stopped the canvas from receiving taps.
- Dismissing the system share sheet does not mark items shared, so `Close` then asks `Discard feedback?`.
- At a tab root the list hides its navigation bar, so the posted task is named `ProcrastiMate Feedback` rather than after the list.
- `post-to-procrastimate` needs a real sign-in, which writes the shared keychain session. `PROCRASTIMATE_SIGNED_IN=1` skips the session, so use the server path for this step.
