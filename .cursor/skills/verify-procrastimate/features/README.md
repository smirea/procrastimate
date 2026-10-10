# Procrastimate verification map

This directory is the maintained source for verifying the user-facing behavior of Procrastimate. Procrastimate is Stefan's personal task manager, a rough Todoist clone with one user, a web client, an iOS client, and an Apple Watch client later. It is local first and synced, every interaction responds instantly, and motion is subtle but satisfying. Features change often, so update the map with the feature and never keep entries for removed behavior.

The web client covers adding, viewing, editing, completing, repeating, prioritizing, reminding, labeling, searching, and theming, and every web step not marked `Planned:` is proven by a Playwright test named in its bullet. iOS, sync, completed-task history, and keyboard selection are still planned. A `Planned:` step describes the intended user path and the observable result, with no harness commands or stable handles. Replace it with exact commands when its feature and harness ship.

## Baseline preconditions

- Generate env values with `env-manager gen --local`, then start the web client and server with `bun run start` from the repo root.
- The web client answers at `http://127.0.0.1:6120` or `http://procrastimate.localhost:6120` and opens on Inbox. The API answers `GET /api/status` through the client proxy with `{"ok":true}`. Every request the page makes stays on the client's origin, proven by `e2e/single-origin.e2e.ts`.
- The production build runs locally with `bun run preview` at `http://127.0.0.1:8787`, serving the client and `/api` on one origin like the deployed Worker. `E2E_WORKER=1 bun run test:e2e` runs the web suite against it after `bun run build`.
- Production answers at `https://procrastimate.stf.lol`, deployed from `master`. `GET /api/status` there returns `{"ok":true}`, and deep links such as `/inbox` serve the app.
- Web data lives in the browser's `localStorage` under the `procrastimate` key. A fresh browser profile is the baseline state with no tasks or projects.
- Run the automated web suite with `bun run test:e2e` from the repo root, after `bunx playwright install --with-deps chromium webkit` once in `app-web/`. It starts its own client on port 6130 with a fresh profile per test and a clock pinned to Wednesday, October 14 2026, 10:00 UTC, so it can run while the dev server is up. Filter with `bun run test:e2e -- <file> -g "<test name>"`.
- The suite has two Playwright projects. `desktop` runs every file except `e2e/mobile.e2e.ts` in Chromium at 1280×800. `mobile` runs only `e2e/mobile.e2e.ts` in WebKit with the `iPhone 15 Pro` profile (393×659, touch). Pick one with `--project desktop` or `--project mobile`.
- Start the iOS client in a simulator with `bun run start:ios -t simulator`. Until the first feature ships, it shows `Hello!`. It needs macOS with Xcode, so a Linux agent skips iOS steps.
- Seed fixtures through quick add, the real user path. Planned: a disposable server store once sync exists.
- Planned: a `verify-procrastimate` skill owns launch, doctor, and cleanup. Until it exists, never drive an instance this run did not start.
- The ports are fixed (`strictPort`), so two web instances cannot run side by side.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Drive the web client through a browser with the `control-ui` skill, or run its Playwright test. Planned: drive the iOS client with XCUITest. Use `xcrun simctl` only for simulator lifecycle, screenshots, and recordings.
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

- [Add a task](./add-task.md) covers quick add from each client, inline natural-language parsing and shorthands, recurrence, keep as text, defaults, and cancel.
- [Complete a task](./complete-task.md) covers completion, undo, and the completion animation.
- [Edit a task](./edit-task.md) covers title, notes, due date, priority, natural language in the title, and delete.
- [Recurring tasks](./recurring-tasks.md) covers setting a repeat, the repeat icon, and completing a recurring task to move it to its next occurrence.
- [Priority](./priority.md) covers priority shortcuts, the priority picker, and priority colors.
- [Reminders](./reminders.md) covers typed and picked reminders, due times that notify on their own, and reminders firing while the app is open.
- [Task views](./task-views.md) covers Inbox, Today, Upcoming, and their empty states.
- [Projects](./projects.md) covers creating projects, `#` autocomplete, and moving tasks between them.
- [Labels](./labels.md) covers `@` labels with autocomplete, row chips, the details picker, and label views.
- [Offline and sync](./offline-sync.md) covers offline use and convergence across clients.
- [Search](./search.md) covers the `/` and Cmd-K shortcuts, matching and ranking across titles, notes, and projects, highlights, keyboard navigation, and completed tasks in results.
- [Theme](./theme.md) covers the System, Light, and Dark themes, persistence, first paint, and contrast.
