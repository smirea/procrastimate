# Notouroboros tasks

Notouroboros, Stefan's voice memo app, extracts tasks from each memo and sends them to ProcrastiMate, which keeps them as ordinary Inbox tasks. A memo task's row shows a small waveform icon on iOS and the web, and its details show a `Notouroboros` line, which opens the memo on iOS. The memo app signs in as its own device with ProcrastiMate's session, which ProcrastiMate shares through the team keychain group while signed in. A link `procrastimate://task/<id>` opens a task's details on iOS.

## Sub-features

- `receive` adds the memo's tasks to the Inbox with the spoken time read as a due date and repeat, or with the memo's calendar event.
- `no-duplicates` skips a task the account has seen before, so a retry adds nothing and a deleted memo task never comes back.
- `row-icon` shows a waveform icon on a memo task's row.
- `details-line` shows `Notouroboros` in task details: a link to `notouroboros://entry?id=<memoId>` on iOS, plain text on the web.
- `task-link` opens `procrastimate://task/<id>` as that task's details on iOS. An unknown id does nothing.
- `shared-session` keeps the keychain item `procrastimate-link` in `FNYFHG5SV7.com.stefan.shared` while signed in, and removes it on sign-out or a rejected session.
- `delete-with-memo` deletes a memo's tasks and their subtasks when the memo app asks.

## How to get to it (user POV)

- iOS: record a memo with a task in Notouroboros. The task appears in Inbox, or No date when it has no date, with the waveform icon. Tap it and tap `Notouroboros` to open the memo.
- iOS: tap a task in Notouroboros to open it in ProcrastiMate.
- Web: the same rows show the waveform icon, and task details show `Notouroboros` without a link.

## Driving it with curl, simctl, and Playwright

Preconditions:

- The server runs with sign-in on: `API_PORT=6141 BETTER_AUTH_SECRET=<any 32 chars> bun src/index.ts` in `server/`. The account lives in memory.
- A session token from `POST /api/auth/sign-up/email` (with an `origin` header naming the server), read from the `set-auth-token` response header.
- For iOS, the app built for an iOS 27 simulator with `API_URL=http://127.0.0.1:6141` on the `xcodebuild` command line and ad hoc signed (`CODE_SIGN_IDENTITY=-`, as `bun run start:ios` does), so the simulator honors the keychain group. A build with `CODE_SIGNING_ALLOWED=NO` gets `-34018` on the shared item.

- **Receive.** `PUT /api/memo-tasks` with `Authorization: Bearer <token>`, `x-procrastimate-device: <uuid>`, `x-procrastimate-device-name: Notouroboros`, and `{"memoId":"<uuid>","recordedAt":<epoch ms>,"tasks":[{"key":"<uuid>","title":"Call the plumber","notes":"","when":"tomorrow at 3pm","event":null}]}`. The response lists the task with `due` set. `GET /api/memo-tasks?memoId=<uuid>` returns the same list. The same `PUT` again changes nothing.
- **Row and details on the web.** The row in No date has the image `From Notouroboros`, and details show `Notouroboros` with no link.
- **Row on iOS.** Sign in with the same account. The Inbox row reads `Call the plumber … Tomorrow 3pm` followed by the waveform. Its accessibility label ends with `From Notouroboros`.
- **Task link.** `xcrun simctl openurl $UDID procrastimate://task/<id>` and confirm `Open`. The task's details sheet opens with a `Notouroboros` link. A made-up id leaves the screen as it was.
- **Shared session.** `xcrun simctl spawn $UDID log show --last 5m --predicate 'category == "procrastimate-link"'` shows `wrote http://127.0.0.1:6141, status 0` after sign-in and at launch, and `deleted, status 0` after `Sign out`.
- **Delete with memo.** `DELETE /api/memo-tasks?memoId=<uuid>` answers `{"ok":true}`, and the next `GET` lists no tasks.

## Gotchas

- Memo and task keys are lowercase UUIDs. An uppercase one gets `400`, and Swift's `UUID().uuidString` is uppercase.
- `recordedAt` is epoch milliseconds, and `when` is read in the account's synced time zone, or UTC before any device has synced one.
- A task without a date sits in No date, not Inbox.
- `simctl openurl` shows an `Open in "ProcrastiMate"?` confirmation that needs a tap.
- A request without `x-procrastimate-device` gets `401`, even with a valid token.
