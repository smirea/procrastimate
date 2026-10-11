# Todoist import

`Import from Todoist` in Settings opens a file picker for the `.zip` backup that Todoist's Settings > Backups downloads. The browser reads it without uploading anything and adds its projects, tasks, subtasks, labels, comments, dates, repeats, priorities, and reminders to the local store in one step. A summary shows the projects and tasks added, the tasks skipped because an earlier import already brought them in, the labels added, and a warning for each thing that did not carry over. Importing the same backup again adds nothing.

## Sub-features

- `import-pick` opens a file picker limited to `.zip` files from `Import from Todoist`.
- `import-read` turns each project CSV into a project, Todoist's Inbox into our Inbox, `@labels` in content into labels, `INDENT` into subtasks, comments into notes, and reminders into reminders.
- `import-dates` reads Todoist dates such as `every March 2nd 11 am`, `Jun 21 2027`, `May 23, 2027`, and `Oct 22` with the quick add parser, and keeps an unreadable date in the task's notes with a warning.
- `import-summary` shows the counts and the warning list.
- `import-dedupe` skips tasks a previous import already added, so re-running is safe.
- `import-error` rejects a file that is not a Todoist backup and changes nothing.

## How to get to it (user POV)

- Web desktop: `Settings` at the bottom of the sidebar, then `Import from Todoist`.
- Web phone: `Open navigation`, `Settings`, then `Import from Todoist`.
- iOS: Planned.

## Driving it with control-ui and XCUITest

Preconditions:

- The baseline state and the synthetic backup from `shared/fixtures/todoist-backup.mts`, zipped by `todoistBackupZip()` in `e2e/fixtures.ts`. Never use a real backup. The repo is public.
- Automated proof: `bun run test:e2e -- e2e/settings.e2e.ts` for desktop, `e2e/mobile.e2e.ts` for the phone, and `bun test shared/todoist.test.ts shared/csv.test.ts` for the reader.

- **Import.** Open Settings, click `Import from Todoist`, and pick the backup in the file chooser. The `Import summary` status reads `2 projects`, `12 tasks`, `0 skipped`, and `3 labels added`, and `Import warnings` lists 3 warnings: an unreadable `every! 3 days`, the `Long Term` sections, and a German date. Test: `importing a Todoist backup twice adds each project and task once`.
- **Result.** After a reload, Inbox lists `Call the dentist` (Oct 22, p1, one reminder), `cancel [meetup.com](https://meetup.com)`, `Renew passport #Travel` (repeats yearly from Mar 2, 2027 11am), `Water plants` (label `home`, notes from its description and comment), and `Fix bike` (notes `Todoist date: every! 3 days`). `Long Term` lists `Visit Japan`, `Read Dune`, and `Read Dune`, with `Visit Japan` showing `0 of 1 subtasks done` and `Book flights` as its subtask. `Job` shows `Quarterly review` with the `work` and `deep-work` labels. Same test.
- **Re-import.** Import the same backup again. The summary reads `0 projects`, `0 tasks`, and `12 skipped`, and every list keeps one copy of each task. Same test, and on a phone `importing a Todoist backup twice from the settings sheet adds each task once`.
- **Wrong file.** Pick a file that is not a zip. An alert reads `This is not a Todoist backup zip.` and no task is added. Test: `a file that is not a Todoist backup shows an error and imports nothing`.
- **Reader.** CSV edge cases (byte order mark, quoted commas and newlines, CRLF), priority, indent, reminders, labels, and every date example. Tests in `shared/todoist.test.ts` and `shared/csv.test.ts`.
- **iOS.** Planned: the picker, zip reader, and summary. The CSV reader, Todoist reader, and merge are already in `Core`: `swift test` in `app-ios/` replays `shared/vectors/csv.json` and `todoist.json` in `VectorTests`, including Todoist date phrases read by `QuickAdd`.

## Gotchas

- Playwright's file chooser bypasses the OS picker. Wait for the `filechooser` event before clicking `Import from Todoist`.
- Dates without a year resolve against the pinned clock, Wednesday, October 14 2026, so `Oct 22` is 2026 and `Oct 13` would be 2027.
- A project named like a label, such as `Work` next to `@work`, makes sidebar link names ambiguous. The fixture uses `Job` for that reason.
