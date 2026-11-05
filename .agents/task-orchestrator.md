---
project: app
gc: agent-t3-worktree gc --repo .
teardown: agent-t3-worktree teardown
ship: pr-ship --merge
---

Repo config for the global `task-orchestrator` skill (`~/code/ai-files/skills/task-orchestrator/`). Its `pm check` validates this file, and `scripts/skill-references.test.ts` fails when it names a repo path that no longer exists.

# Orchestrator

- Decision docs: `docs/decisions/README.md` and the area files the tasks touch.
- Clients a job can cover: iOS (app and widgets), web, server.
- Every task that restructures the same screen or component goes in one job: one run had four jobs reshaping the list screens, and the last of them rebased six times.
- iOS jobs run in parallel too: `./sim` holds a headless boot while the Mac's total CPU is above 70% or 4 simulators are booted, telling the child it waits. Schema changes don't need sequencing: they are additive.
- The `app` project files bugs and features in its `Bugs` and `Features` sections.
- Post-merge check: a merge that touched `app-ios/` also needs master's TestFlight run (`gh run list --workflow testflight.yml --branch master -L 1`) to succeed.
- Known shared failures: a simulator runtime that stopped booting.

# Worker

## Setup

- Read `docs/decisions/README.md`.
- T3's setup also ran `bun run generate` and made a git-ignored `./sim`. Your server runs on your own ports from `.env.override` over a SQLite file in your worktree's `.data/`; nothing is shared.
- Plain `bun run start` signs in against the in-memory auth database. E2E tests sign in on their own.
- The machine is loaded, so run e2e specs one or two at a time, and only those that cover the change.

## iOS: boot a simulator only to look at the app

The Mac runs many jobs at once, and each booted simulator slows all of them. Climb this ladder and stop at the first rung that proves the change, but a change to what the user sees or taps always reaches rung 3, and the test taps it:

1. Logic in `app-ios/Sources/Core`: `app-ios/scripts/test` (seconds, no simulator).
2. Does the app compile: `./sim build` (no boot). Use it after every rebase too, and as the check for a Swift conflict when `pr-ship` exits 2. Never use `./sim --no-watch` as a compile check.
3. UI behavior: `./sim test <file.swift>... [--only Class/test]`. It builds, boots, runs throwaway XCUITests under a time limit, and shuts the simulator down. In each test, start the app with `launchApp(demo:reset:environment:)` and save screenshots with `shot("name")`; both come from the generated `Support.swift`. Write the test files outside the repo, batch every check into one run, and finish the web side first so the simulator boots once, late. Never build your own XCUITest project in `/tmp`.

- `./sim` and `./sim test` wait before booting while the Mac's total CPU is above 70% or 4 simulators are booted, and say so. If one exits 3 after three minutes, rerun it, and do other work between reruns if you have any.
- Only when you must look at the live app by hand: `./sim --no-watch` builds and launches it headless. Then `device_list`, and `device_open` with its `hostId` and the `id` from `./sim udid`; drive and capture it with the `agent-device` command that returns, tapping by label (`press 'label="Save"' --settle`). Never `simctl boot` yourself or drive the app with raw `simctl`. `--keep` on `./sim test` and a manual launch both leave it booted: `agent-device close`, `device_close` with `shutdown: true`, and `./sim stop` as soon as you have what you need.
- Device-only checks: a headless simulator can't prove notification banners, pushes, or real camera hardware. Prove the logic with tests and name the device check in `verification`. Everything else, including widgets, their animations, and layouts, the simulator can prove: test it there with `./sim test` and never hand it to Stefan as a device check.
- Upgrade check for entitlements, `Info.plist`, extensions, signing, or on-device stored data: install master's build on your simulator (from a throwaway `git worktree add`), then yours over it, and launch with the existing data. A Release-only setting you can't build locally gets a line in `verification`.

## Done means

- `.cursor/skills/verify-procrastimate/features/` says how to drive each feature.

## PR

- Schema changes are additive: the server adds missing tables, columns, and indexes on start, and never drops or retypes one. A retyped column gets a new name, and a `NOT NULL` column added later needs a default.

## After the merge

- A Worker secret goes on the Worker with `bun run secrets:push` after its `env-manager up`. If master's deploy already failed for lack of it, `gh run rerun --failed <run>` then check `gh run view <run> --json status,conclusion` in foreground calls until `status` is `completed`. Report `merged` only once its `conclusion` is `success`; a failed deploy is `blocked` with the run link.
- `./sim stop` your simulators as part of cleanup.
