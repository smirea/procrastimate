# ProcrastiMate verification map

This directory is the maintained source for verifying the user-facing behavior of ProcrastiMate. ProcrastiMate is Stefan's personal task manager, a rough Todoist clone with one user, a web client, an iOS client, and an Apple Watch client later. It is local first and synced, every interaction responds instantly, and motion is subtle but satisfying. Features change often, so update the map with the feature and never keep entries for removed behavior.

The web client covers adding, viewing, editing, completing, subtasks, repeating, prioritizing, reminding, push notifications, labeling, searching, theming, settings, syncing between paired clients, and importing from Todoist, sharing with other accounts, AI accounts, and public links, and commenting on tasks. The steps below are how to drive each feature by hand. Automated proof is the parser and vector tests, plus the auth and sync smoke in `docs/decisions/testing.md`. Named Playwright and XCUITest commands in these files are retired. iOS, Ramble voice capture, and keyboard selection are still planned. A `Planned:` step describes the intended user path and the observable result, with no harness commands or stable handles. Replace it with exact commands when its feature and harness ship.

The iOS app works with Siri, Shortcuts, and Spotlight. Every new feature that someone can do from outside the app ships with App Intents in the same change. The web client is excluded: those are iOS system features, so they have no web steps.

## Baseline preconditions

- Generate env values with `env-manager gen --local`, then start the web client and server with `bun run start` from the repo root.
- The web client answers at `http://127.0.0.1:6120` or `http://procrastimate.localhost:6120` and opens on Inbox. The API answers `GET /api/status` through the client proxy with `{"ok":true}`. Every request the page makes stays on the client's origin.
- The production build runs locally with `bun run preview` at `http://127.0.0.1:8787`, serving the client and `/api` on one origin like the deployed Worker. `E2E_WORKER=1 bun run test:e2e` runs the web suite against it after `bun run build`.
- Production answers at `https://procrastimate.stf.lol`, deployed from `master`. `GET /api/status` there returns `{"ok":true}`, and deep links such as `/inbox` serve the app.
- Web data lives in the browser's `localStorage` under the `procrastimate` key. A fresh browser profile is the baseline state with no tasks or projects.
- The automated web smoke is `bun run test:e2e` from the repo root (`e2e/auth.e2e.ts`, `e2e/sync.e2e.ts`, `e2e/memo-tasks.e2e.ts`, `e2e/merged-names.e2e.ts`, `e2e/task-row.e2e.ts`, `e2e/sharing.e2e.ts`, `e2e/images.e2e.ts`, and `e2e/layout.e2e.ts`, Chromium, 1280×800; the layout spec also runs at 393 px). Install Chromium once with `bunx playwright install --with-deps chromium` in `app-web/`. It starts its own client on port 6130 with a fresh profile per test and a clock pinned to Wednesday, October 14 2026, 10:00 UTC.
- `swift test` in `app-ios/` runs the Core unit tests, including the TS-to-Swift vectors. There is no XCUITest suite.
- Start the iOS client in a simulator with `bun run start:ios -t simulator`. It opens on an empty Inbox. The tab bar has Inbox, No date, and Browse, plus the accent `+` circle beside it that opens quick add. Search is the field at the top of Browse. It needs macOS with Xcode, so a Linux agent runs only `swift test` in `app-ios/` and leaves the app to the iOS workflow.
- Debug builds can launch with `PROCRASTIMATE_NOW=2026-10-14T10:00:00Z`, `PROCRASTIMATE_TZ=UTC`, and `PROCRASTIMATE_RESET=1` for an empty store at the pinned moment. Release builds ignore those keys.
- Seed fixtures through quick add, the real user path. The dev server's sync account lives in memory, so restarting `bun run start` gives a disposable one.
- Planned: a `verify-procrastimate` skill owns launch, doctor, and cleanup. Until it exists, never drive an instance this run did not start.
- The ports are fixed (`strictPort`), so two web instances cannot run side by side.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Drive the web client through a browser with the `control-ui` skill. Use `xcrun simctl` only for simulator lifecycle, screenshots, and recordings.
- Prefer accessible roles and names over CSS selectors, coordinates, or tab order.
- Below 768 px wide the web client is in its phone layout. The sidebar is hidden behind `Open navigation`, a floating `Quick add` button replaces the `q` shortcut, and quick add and task details open as bottom sheets. Drive phone steps with taps, not keyboard shortcuts.
- Exercise the real user path. Do not call internal setters, test-only endpoints, or the sync API directly.
- Restore seeded data after a mutation. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- Web proof is an accessibility snapshot and a screenshot. iOS proof is a simulator screenshot.
- Mutation proof includes a second view of the stored value: a reload, a relaunch, or the other client.
- Snappiness and motion are product requirements. For any interaction, a visible delay or a spinner on local data is a failure. Record a short screen recording when a feature file asks for motion proof.
- Record the feature file, sub-feature ID, client, and entry point with every artifact.
- Report an unreachable or planned path with the attempted step and the unmet precondition.
- Do not report a skipped entry point or client as verified through a different one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point on each client.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result. Mark a bullet `Planned:` when its feature or harness does not exist yet.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Add a task](./add-task.md) covers quick add from each client, inline natural-language parsing and shorthands, recurrence, the chip row, defaults, and cancel.
- [Complete a task](./complete-task.md) covers completion, undo, the completion animation, the Completed view with its range filter, the completed toggle in project and label views, and reopening.
- [Edit a task](./edit-task.md) covers title, notes, due date, priority, natural language in the title, and delete.
- [Task images](./task-images.md) covers attaching images by picker, paste, drop, photo library, or camera, thumbnails in details, the row count, the full-screen viewer, delete with undo, offline adds, and images on shared tasks.
- [Subtasks](./subtasks.md) covers adding, checking, reordering, and nesting subtasks, parent progress, and how completing or repeating a parent treats them.
- [Recurring tasks](./recurring-tasks.md) covers setting a repeat, the repeat icon, and completing a recurring task to move it to its next occurrence.
- [Priority](./priority.md) covers priority shortcuts, the priority picker, and priority colors.
- [Reminders](./reminders.md) covers typed and picked reminders, due times that notify on their own, and reminders firing while the app is open.
- [Push notifications](./push-notifications.md) covers turning on Web Push, the permission and Home Screen guidance, the synced schedule, and notifications while the app is closed.
- [Task views](./task-views.md) covers the Inbox with its Overdue, Today, and day sections, the No date view, their counts, and their empty states.
- [Copy as Markdown](./copy-markdown.md) covers copying a view, a section, or a task to the clipboard as a Markdown checklist.
- [Projects](./projects.md) covers creating projects, `#` autocomplete, moving tasks between them, and the sections inside a project.
- [Labels](./labels.md) covers `@` labels with autocomplete, row chips, the details picker, and label views.
- [Offline and sync](./offline-sync.md) covers offline use and convergence across clients.
- [Search](./search.md) covers the `/` and Cmd-K shortcuts, matching and ranking across titles, notes, and projects, highlights, keyboard navigation, and completed tasks in results.
- [Settings](./settings.md) covers the settings popover on desktop and the settings sheet on a phone.
- [Todoist import](./todoist-import.md) covers importing a Todoist backup zip, the summary and warnings, and safe re-imports.
- [Theme](./theme.md) covers the System, Light, and Dark themes, persistence, first paint, and contrast.
- [Places and events](./places-and-events.md) covers places and calendar events on tasks, set on the iPhone: the Maps search and Arrive, Leave, or During, the calendar event picker, rows, the Browse sections, notifications, the Live Activity, and moved events.
- [Notouroboros tasks](./notouroboros-tasks.md) covers tasks Notouroboros sends: the waveform icon on rows, the `Notouroboros` line in details, `procrastimate://task/<id>` links, and the shared session.
- [Siri, Shortcuts, and Spotlight](./app-intents.md) covers the iOS App Intents: adding and completing tasks, opening lists and projects, search, today's and overdue tasks, and Spotlight. Web is excluded.
