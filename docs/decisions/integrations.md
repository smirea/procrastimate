# Integrations

Other apps on Stefan's iPhone create and read ProcrastiMate tasks. The first one is NoteTorus, his voice memo app (`~/code/ios-voice-memo`, bundle id `com.stefan.notetorus`), which extracts tasks from each memo with Apple's on-device model and sends them here.

- **ProcrastiMate is the source of truth for tasks.** NoteTorus keeps audio, transcripts, summaries, and the calendar event a memo is attached to. It no longer has reminders of its own. Once a task arrives here it is an ordinary task: editing, completing, or deleting it happens in ProcrastiMate, and the memo app only reads it back.
- **Through the server, not app to app.** iOS has no background channel between apps, and the memo app processes in the background. It calls the Worker with the same session ProcrastiMate uses, so the tasks reach every device through the usual sync nudge, whether or not ProcrastiMate is running.
- **No configuration.** Both apps are signed by team `FNYFHG5SV7` and share the keychain access group `FNYFHG5SV7.com.stefan.shared`. While signed in, ProcrastiMate keeps one generic password there, service `procrastimate-link`, account `default`, whose data is the JSON `{ "apiURL": "…", "token": "…" }`: its own API URL and its Better Auth bearer token. It writes the item at launch and after sign-in, and deletes it on sign-out or a `401`. The item is readable after first unlock, because the memo app processes with the screen locked. A Debug and a Release build share the bundle id, so only one is installed and the item always names the server that build talks to.
- **The entitlement lists the app's own group first.** `Config/App.entitlements` lists `$(AppIdentifierPrefix)com.stefan.procrastimate` before `$(AppIdentifierPrefix)com.stefan.shared`. Keychain writes without a group go to the first entry, so the session token itself stays private to ProcrastiMate.
- **Simulator builds are signed ad hoc.** A simulator honors keychain groups only from embedded entitlements, and a build with `CODE_SIGNING_ALLOWED=NO` gets `errSecMissingEntitlement` (`-34018`) on the shared item. `app-ios/scripts/run` builds for the simulator with `CODE_SIGN_IDENTITY=-`, and the memo app has to do the same for the two to share the item there.
- **The memo app is a device.** It sends `Authorization: Bearer <token>`, its own `x-procrastimate-device` id, and `x-procrastimate-device-name: NoteTorus`. It shows up beside the phone and the browser and can be revoked like them. Sharing the session rather than minting a narrower token is deliberate: one user, one phone, and both apps are Stefan's. ProcrastiMate signing out revokes the memo app with it.

## The memo task contract

All three routes are account routes in `shared/api/contract.ts`, served by the `Account` object as the device the request names.

- **A memo task's `sourceKey` is `voicememo:<memoId>:<taskKey>`**, both lowercase UUIDs from the memo app. `shared/memo-tasks.ts` (ported to Core) builds and reads it. Nothing else marks the task: no label, no project. Every client derives the memo link from the key.
- **Keys are checked, not normalized.** `memoId` and every `key` must be lowercase UUIDs, or the request gets `400`. Swift's `uuidString` is uppercase, so the memo app lowercases it.
- **`PUT /api/memo-tasks`** takes `{ memoId, recordedAt, tasks: [{ key, title, notes, when, event }] }` and returns the memo's tasks. `recordedAt` is epoch milliseconds, like every other moment in the contract.
  - `title` is the task. `notes` holds why it matters, with the memo's own words quoted.
  - `when` is the spoken time phrase copied from the memo, such as `tomorrow at 3pm`, or null. The server parses it with the quick-add grammar (`spoken: true`) as of `recordedAt` in the account's synced time zone, or UTC before any device has synced one, and keeps only the due date and repeat it finds. A phrase it cannot read leaves the task undated.
  - `event` is a `TaskEvent` for the memo's attached calendar event, or null. The memo app sets it only when the memo ties the task to that event, such as "before next week's standup". Being recorded during an event does not make a task an event task. An event replaces the due date and repeat, as it does everywhere, so the server ignores `when` on a task that has one. The phone rewrites the event's occurrences from the calendar as for any event task.
  - The tasks land in the Inbox. A key the account has already seen is skipped, live or deleted, so a retry never duplicates a task and never brings back one Stefan deleted. The ops use `voicememo:<memoId>:<taskKey>` as their op id, so the log dedupes them too.
- **`GET /api/memo-tasks?memoId=…`** returns `{ tasks: [{ key, id, title, completedAt, due, event }] }`, the memo's live tasks in the order they were sent, completed ones included. A deleted task is simply absent.
- **`GET` and `DELETE` read `memoId` from the query.** The `Account` object forwards routes by exact method and path, so there are no path parameters, and the contract declares both with oRPC's detailed input structure because a compact `DELETE` would read a body.
- **`DELETE /api/memo-tasks?memoId=…`** deletes the memo's live tasks and their subtasks and returns `{ "ok": true }`. The memo app calls it only when Stefan chooses to delete the tasks along with the memo.

## Links

- **ProcrastiMate opens `procrastimate://task/<id>`** on iOS: it shows that task's details over the current screen. An unknown id does nothing.
- **NoteTorus opens `notetorus://entry?id=<memoId>`.** A memo task's row shows a small waveform icon, on iOS and the web. Its details show `NoteTorus`, which opens the memo on iOS. The web shows the same line without a link, because a browser cannot open the phone app.
- **The memo app assumes ProcrastiMate is installed.** It checks with `canOpenURL(procrastimate://)`. When ProcrastiMate is missing, the memo's extracted tasks stay on the memo with the note `Could save these todos if you also had ProcrastiMate.` When it is installed but signed out, the note asks to sign in. Either way the tasks go out on their own once the link appears.
- **Deleting a memo keeps its tasks.** When a memo has tasks in ProcrastiMate, deleting it asks whether to delete them too, and the default keeps them. A kept task keeps its link, which then opens a memo that no longer exists.
