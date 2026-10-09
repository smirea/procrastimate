# Procrastimate verification map

This directory is the maintained source for verifying the user-facing behavior of Procrastimate. Procrastimate is Stefan's personal task manager, a rough Todoist clone with one user, a web client, an iOS client, and an Apple Watch client later. It is local first and synced, every interaction responds instantly, and motion is subtle but satisfying. Features change often, so update the map with the feature and never keep entries for removed behavior.

Today the app is a hello screen, so every feature below is planned. A `Planned:` step describes the intended user path and the observable result, with no harness commands or stable handles. Replace it with exact commands when its feature and harness ship.

## Baseline preconditions

- Generate env values with `env-manager gen --local`, then start the web client and server with `bun run start` from the repo root.
- The web client answers at `http://127.0.0.1:6120` or `http://procrastimate.localhost:6120`. The API answers `GET /api/status` through the client proxy with `{"ok":true}`.
- Start the iOS client with `bun run start:ios`. It needs macOS with Xcode, so a Linux agent skips iOS steps.
- Planned: start each run against a disposable local store and a disposable server store, seeded with the fixtures that each feature file names.
- Planned: a `verify-procrastimate` skill owns launch, doctor, and cleanup. Until it exists, never drive an instance this run did not start.
- The ports are fixed (`strictPort`), so two web instances cannot run side by side.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Drive the web client through a browser with the `control-ui` skill. Drive the iOS client in the simulator with `xcrun simctl`.
- Prefer accessible roles and names over CSS selectors, coordinates, or tab order.
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

- [Add a task](./add-task.md) covers quick add from each client, due dates, and cancel.
- [Complete a task](./complete-task.md) covers completion, undo, and the completion animation.
- [Edit a task](./edit-task.md) covers title, notes, due date, priority, and delete.
- [Task views](./task-views.md) covers Inbox, Today, Upcoming, and their empty states.
- [Projects](./projects.md) covers creating projects and moving tasks between them.
- [Offline and sync](./offline-sync.md) covers offline use and convergence across clients.
