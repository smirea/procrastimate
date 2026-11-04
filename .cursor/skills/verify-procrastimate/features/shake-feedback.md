# Shake to give feedback

Shaking the iPhone freezes the screen into Feetback's feedback editor, in Debug and Release builds alike. Stefan taps a component on the frozen screenshot, writes what should change, and repeats for as many items as he needs. Share exports an annotated image, a JSON report naming each component's source file and line and the data it showed, or both in a ZIP. The `ProcrastiMate` share target posts the feedback as a task in a picked project, with the image and `feedback.json` attached, using the app's own session. The web client is excluded: Feetback has no web package yet.

## Sub-features

- `shake-open` opens the editor over the current screen on a shake, with the whole scrolling list captured at full length.
- `tap-select` selects the smallest tagged component or accessibility element under a tap, and shows its parent, its `file:line`, and its data under the screenshot.
- `export` shares the annotated image, the JSON report, or both in a ZIP. The JSON's `context` lists `Session`, `Sync`, `Navigation`, and `Store`.
- `post-to-procrastimate` adds a task named after the screen followed by `Feedback` to the picked project, with the image and `feedback.json` attached.
- `discard-prompt` asks before closing the editor with items never shared.

## How to get to it (user POV)

- iOS: shake the iPhone on any screen. In the simulator, use **Device › Shake**.
- Web: none.

## Driving it with agent-device and simctl

Preconditions:

- The app built for the worktree's simulator with `./sim --no-watch`, ad hoc signed so the shared keychain group counts.
- For `post-to-procrastimate`, the worktree's server running with `bun run start:server`, an account from `POST /api/auth/sign-up/email`, a project from `POST /api/projects`, and the app signed in to that account.
- For a long list without a server, launch with `SIMCTL_CHILD_PROCRASTIMATE_RESET=1 SIMCTL_CHILD_PROCRASTIMATE_SIGNED_IN=1 SIMCTL_CHILD_PROCRASTIMATE_OFFLINE=1 SIMCTL_CHILD_PROCRASTIMATE_PERF=<path> SIMCTL_CHILD_PROCRASTIMATE_DEMO=bulk:300 xcrun simctl launch <udid> com.stefan.procrastimate`.

- **Shake.** `xcrun simctl notify_post <udid> com.apple.UIKit.SimulatorShake`. After about 3 s on a long list, a snapshot shows `Close`, `Feedback`, `Feedback list, 0 items`, and the `Feedback text` field.
- **Tap select.** Press a point on a task row in the screenshot with a plain coordinate press (no `--settle`). The selection reads the row's combined button, with `Select parent, TaskRow` and `App/TaskRow.swift` with a line number, and the task's data starting `task: Task(id: …`.
- **Export.** Type a note, press `Add feedback`, then `Share` and `JSON`. Read `"$(xcrun simctl get_app_container <udid> com.stefan.procrastimate data)/tmp/feedback.json"`; its `context` has the four entries above. Replay its taps with Feetback's `skills/feetback-accessibility/scripts/taps.py`: on the seeded Inbox about a quarter of the grid falls through, all of it in the gaps between rows.
- **Post to ProcrastiMate.** `Share`, then `ProcrastiMate`. The sheet `Add to ProcrastiMate` lists `Inbox` and the account's projects. Pick one and press `Add`. `GET /api/view` lists the task in that project with two attachments, an image and `feedback.json`, and the project's screen in the app shows it with `2` beside the paperclip.

## Gotchas

- Only a coordinate press reaches the editor's canvas reliably. A snapshot or `--settle` between presses has stopped the canvas from receiving taps.
- Dismissing the system share sheet does not mark items shared, so `Close` then asks `Discard feedback?`.
- At a tab root the list hides its navigation bar, so the posted task is named `ProcrastiMate Feedback` rather than after the list.
- `post-to-procrastimate` needs a real sign-in, which writes the shared keychain session. `PROCRASTIMATE_SIGNED_IN=1` skips the session, so use the server path for this step.
