# How to work

You own this job end to end, through the merge. Stefan authorized you to merge your PR without asking.

## Setup

- Read `AGENTS.md`, `docs/decisions/README.md`, the area files the brief names, and the `AGENTS.md` of every folder you change. A decision your work introduces or revises goes in its area file in this PR.
- This file and those docs can go stale. When an instruction is wrong (a script that moved, a flag that changed, a tool you do have), do what is right, fix the instruction in this PR, and say so in your report's `summary`.
- T3 already ran `scripts/setup-worktree.ts` and owns the branch name. Check that `node_modules` and `./sim` exist. Only if they don't, run `bun scripts/setup-worktree.ts` with no branch argument. Your server runs on your own ports over a SQLite file in your worktree's `.data/`; nothing is shared.
- Never read or copy the main checkout's env files, never touch the main checkout or another worktree's servers or simulators, and never run `env-manager up`, `down`, or `env set` before your PR merges. A new setting goes in the root `.env` schema with a harmless default, since worktrees and CI build from the defaults (`env-manager gen --local`); its real values go up after the merge (see "After the merge"). Anything else you need from outside, such as a Sentry event, is in the brief; if it isn't, ask for it with `needs_input`.
- Plain `bun run start` signs in against the in-memory auth database. E2E tests sign in on their own. Use only your own ports from `.env.override`.

## iOS: boot a simulator only to look at the app

The Mac runs many jobs at once, and each booted simulator slows all of them. Climb this ladder and stop at the first rung that proves the change, but a change to what the user sees or taps always reaches rung 3, and the test taps it:

1. Logic in `app-ios/Sources/Core`: `app-ios/scripts/test` (seconds, no simulator).
2. Does the app compile: `./sim build` (no boot). Use it after every rebase too. Never use `./sim --no-watch` as a compile check.
3. UI behavior: `./sim test <file.swift>... [--only Class/test]`. It builds, boots, runs throwaway XCUITests under a time limit, and shuts the simulator down. In each test, start the app with `launchApp(demo:reset:environment:)` and save screenshots with `shot("name")`; both come from the generated `Support.swift`. Write the test files outside the repo, batch every check into one run, and finish the web side first so the simulator boots once, late. Never build your own XCUITest project in `/tmp`.

- `./sim` and `./sim test` wait before booting while the Mac's total CPU is above 70%, and say so. If one exits 3 after three minutes, rerun it, and do other work between reruns if you have any.
- Only when you must look at the live app by hand: `./sim --no-watch` builds and launches it headless. Then `device_list`, and `device_open` with its `hostId` and the `id` from `./sim udid`; drive and capture it with the `agent-device` command that returns. Never `simctl boot` yourself or drive the app with raw `simctl`. `--keep` on `./sim test` and a manual launch both leave it booted: `agent-device close`, `device_close` with `shutdown: true`, and `./sim stop` as soon as you have what you need.
- A headless simulator can't prove notification banners, pushes, or real camera hardware. Prove the logic with tests, then report the on-device check as a followup instead of trying. Everything else, including widgets, their animations, and layouts, the simulator can prove: test it there with `./sim test` and never hand it to Stefan as a device check.

## Shell

- Never end your turn while anything you started still runs: a background command, `./sim test`, or a review or other subagent. Nothing wakes you once the turn ends, and the orchestrator has to restart you. Run subagents and reviews in the foreground.
- A command that may outlive the 600 s tool limit, such as an eval, runs detached with unbuffered output to a file (`nohup cmd > out.log 2>&1 &`), and you wait for it in foreground calls of under 600 s each. Background jobs the harness starts are killed after 30 minutes.
- Never pipe `pr-ship`, `git push`, or a test run through `tail`/`head`: the pipe hides the exit status and the error. If the output is long, redirect it to a file and read the end.
- Stop every server you start, by its pid. Never `pkill -f` a pattern another worktree could match. macOS has no `timeout`. Don't chain `sleep` before another command, because a hook blocks it.
- Never use `git stash`; it is shared with every worktree. Use a WIP commit. For a baseline on master, `git worktree add` a throwaway checkout instead.
- The machine is loaded, so run e2e specs one or two at a time, and only those that cover the change. A timeout that passes when rerun alone is load; a failure that repeats is yours.
- Git hooks can't be skipped (a Claude Code hook blocks it). A failing hook gets its cause fixed, in this PR or as a followup. A flaky test is a bad test: fix why it flakes, or report it as a followup with the failing output, and never add retries or sleeps. "Fails only in this environment" is a followup too, not a reason to move on.

## Done means

- You proved the change the way Stefan will use it: the tap and what it does, the command he runs, the page at desktop and phone widths. A screenshot proves a layout, not a behavior, so drive the interaction. `.cursor/skills/verify-procrastimate/features/` says how to drive each feature.
- "The simulator can't test this" holds only for the device-only checks the iOS section lists. Anything else is a problem to solve, not a result.
- Never make a path the default, or merge it, before it has worked once end to end.
- A change to entitlements, `Info.plist`, app extensions, signing, or on-device stored data can crash the installed app at launch while every test passes. Install master's build on your simulator (from a throwaway `git worktree add`), then yours over it, and launch with the existing data. A Release-only setting you can't build locally gets a `tooling` followup and a line in `verification`.
- The report's `verification` says what you ran, what you saw, and what you could not verify.

## PR

- Open one PR whose description starts with the `# Tasks being addressed` section the brief gives you, verbatim. Attach screenshots with `gh pr create --attach <file>` (UI changes only, 2 to 4). Then call `link_pull_request` with the PR URL.
- Then loop `bun scripts/pr-ship.ts --merge` in the foreground with a 600000 ms tool timeout. Its last line is `pr-ship exit <n>`:
  - `0`: merged.
  - `1`: fix the failing checks, or fix or answer each review thread and resolve it. Then push and rerun. If a failing check also fails on master or other PRs, rerun it once with `gh run rerun --failed`; if it fails again, fix it in this PR only when the fix is small and clearly yours to make, otherwise end with `blocked` and the run link.
  - `2`: another job landed first. Before resolving, read what it changed and why: `git log origin/master -- <conflicted file>` and `gh pr view <number>` for each PR that touched it, so you keep both intents instead of one side. Rebase onto `origin/master`, rerun only the checks that cover the conflicted files (`./sim build` for Swift), push, rerun. During a rebase, `--theirs` is your branch and `--ours` is master.
  - `3`: rerun.
  - `4`: end with `needs_input` and the printed message in `summary`. Codex has not reviewed, and only Stefan's account can nudge it: the script posts `@codex review` itself when this machine has his `gh` login.
- Wait on CI only with `pr-ship`, never `gh run watch`. Treat review-bot comments skeptically: fix real bugs, and dismiss noise with a concrete reason in your reply.
- Schema changes are additive: the server adds missing tables, columns, and indexes on start, and never drops or retypes one. A retyped column gets a new name, and a `NOT NULL` column added later needs a default.
- A job the brief marks as research, or "don't merge": open a draft PR, skip `pr-ship`, and end with `needs_input`, the findings in `summary`, and the decisions you need in `questions`.

## After the merge

- A new setting: upload its values now, from your worktree. For each environment it needs, `env-manager env set dev` (or `prod`), which downloads that environment's real values over your placeholders, set the value in the root `.env.local`, then `env-manager up`. Never `up` without that `env set` first: it would upload the schema defaults over the real values. Never push a commit either command makes; teardown deletes the branch. A Worker secret then goes on the Worker with `bun run secrets:push`, and if master's deploy already failed for lack of it, `gh run rerun --failed <run>` then check `gh run view <run> --json status,conclusion` in foreground calls until `status` is `completed`. Report `merged` only once its `conclusion` is `success`; a failed deploy is `blocked` with the run link. A value only Stefan has (a key from a dashboard) is a `needs_input` instead.
- Clean up what you started: stop your servers by pid, close your `agent-device` session, `device_close` and `./sim stop` your simulators, and `trash` scratch files outside the worktree. Leave the worktree, its simulators, its data, and its branches: the orchestrator's teardown removes them.

## Scope and report

- Write the code yourself. Subagents only review or research, in the foreground.
- Note bugs, weird interactions, bad UX, jank, or performance issues you find along the way as followups instead of fixing out-of-scope work. Report only real bugs and clearly useful gaps, not every edge case you can imagine. Dev-tooling friction (a slow command, a flaky tool, a manual step) is a followup with `"type": "tooling"` unless the fix is small enough to make in this PR.
- Don't message the orchestrator mid-job. If you need input, end with `needs_input`, and keep your worktree as it is.
- End with only this JSON:

```json
{"status": "merged" | "needs_input" | "blocked", "pr": "<url or null>", "branch": "...", "worktree": "<absolute path>", "tasks": {"done": ["<id>"], "not_done": [{"id": "...", "reason": "..."}]}, "summary": "<2-4 sentences: what changed, clients covered>", "verification": "<what you ran, what you saw, what you could not verify>", "questions": "<for needs_input/blocked>", "followups": [{"title": "...", "description": "...", "type": "bug" | "feature" | "tooling", "relatedTaskId": "..."}]}
```
