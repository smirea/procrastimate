# How to work

You own this job end to end, through the merge. Stefan authorized you to merge your PR without asking.

## Setup

- T3 already ran `scripts/setup-worktree.ts` and owns the branch name. Check that `node_modules` and `./sim` exist. Only if they don't, run `bun scripts/setup-worktree.ts` with no branch argument. If it fails on Docker, Postgres, or PowerSync, end with `blocked` and its error; never restart the shared Postgres, because every other worktree's PowerSync stops with it.
- Never `env-manager up`/`down`, never read or copy the main checkout's `.env.local` (it points at the shared dev database), and never touch the main checkout or another worktree's servers or simulators. Anything you need from outside, such as a Sentry event, is in the brief; if it isn't, ask for it with `needs_input`.
- Plain `bun run start` signs in against the in-memory auth database. E2E tests sign in on their own. Use only your own ports from `.env.override`.

## iOS: boot a simulator only to look at the app

The Mac runs many jobs at once, and each booted simulator slows all of them. Climb this ladder and stop at the first rung that proves the change:

1. Logic in `app-ios/Core`: `app-ios/scripts/test` (seconds, no simulator).
2. Does the app compile: `./sim build` (no boot). Use it after every rebase too. Never use `./sim --no-watch` as a compile check.
3. UI behavior: `./sim test <file.swift>... [--only Class/test]`. It builds, boots, runs throwaway XCUITests under a time limit, and shuts the simulator down. In each test, start the app with `launchApp(demo:reset:environment:)` and save screenshots with `shot("name")`; both come from the generated `Support.swift`. Write the test files outside the repo, batch every check into one run, and finish the web side first so the simulator boots once, late. Never build your own XCUITest project in `/tmp`.

- Only when you must look at the live app by hand: `./sim --no-watch` builds and launches it headless, and `xcrun simctl io $(./sim udid) screenshot <file>.png` captures it. Never `simctl boot` yourself. `--keep` on `./sim test` and a manual launch both leave it booted: `./sim stop` as soon as you have what you need.
- A headless simulator can't prove notification banners, pushes, or anything needing a physical device. Prove the logic with tests, then report the on-device check as a followup instead of trying.
- You have no `device_open`; agent device access is off.

## Shell

- Never end your turn while anything you started still runs: a background command, `./sim test`, or a review or other subagent. Nothing wakes you once the turn ends, and the orchestrator has to restart you. Run subagents and reviews in the foreground.
- A command that may outlive the 600 s tool limit, such as an eval, runs detached with unbuffered output to a file (`nohup cmd > out.log 2>&1 &`), and you wait for it in foreground calls of under 600 s each. Background jobs the harness starts are killed after 30 minutes.
- Never pipe `pr-ship`, `git push`, or a test run through `tail`/`head`: the pipe hides the exit status and the error. If the output is long, redirect it to a file and read the end.
- Stop every server you start, by its pid. Never `pkill -f` a pattern another worktree could match. macOS has no `timeout`. Don't chain `sleep` before another command, because a hook blocks it.
- Never use `git stash`; it is shared with every worktree. Use a WIP commit. For a baseline on master, `git worktree add` a throwaway checkout instead.
- The machine is loaded, so run e2e specs one or two at a time, and only those that cover the change. A timeout that passes when rerun alone is load; a failure that repeats is yours.
- Git hooks can't be skipped (a Claude Code hook blocks it). A failing hook gets its cause fixed, in this PR or as a followup. A flaky test is a bad test: fix why it flakes, or report it as a followup with the failing output, and never add retries or sleeps. "Fails only in this environment" is a followup too, not a reason to move on.

## PR

- Open one PR whose description starts with the `# Tasks being addressed` section the brief gives you, verbatim. Attach screenshots with `gh pr create --attach <file>` (UI changes only, 2 to 4). Then call `link_pull_request` with the PR URL.
- Then loop `bun scripts/pr-ship.ts --merge` in the foreground with a 600000 ms tool timeout. Its last line is `pr-ship exit <n>`:
  - `0`: merged.
  - `1`: fix the failing checks, or fix or answer each review thread and resolve it. Then push and rerun. If a failing check also fails on master or other PRs, rerun it once with `gh run rerun --failed`; if it fails again, fix it in this PR only when the fix is small and clearly yours to make, otherwise end with `blocked` and the run link.
  - `2`: rebase onto `origin/master`, rerun only the checks that cover the conflicted files (`./sim build` for Swift), push, rerun. During a rebase, `--theirs` is your branch and `--ours` is master.
  - `3`: rerun.
- Wait on CI only with `pr-ship`, never `gh run watch`. Treat review-bot comments skeptically: fix real bugs, and dismiss noise with a concrete reason in your reply.
- Migrations: never run an unmerged migration against a shared database. A database whose history isn't a prefix of the code's refuses to migrate, which locks it for master. Two migration PRs conflict in `server/drizzle/meta/_journal.json`. The PR that merges second deletes its migration, rebases, and reruns `bun run db:generate`. Never hand-merge the journal.
- A job the brief marks as research, or "don't merge": open a draft PR, skip `pr-ship`, and end with `needs_input`, the findings in `summary`, and the decisions you need in `questions`.

## Scope and report

- Note bugs, weird interactions, bad UX, jank, or performance issues you find along the way as followups instead of fixing out-of-scope work. Report only real bugs and clearly useful gaps, not every edge case you can imagine.
- Don't message the orchestrator mid-job. If you need input, end with `needs_input`, and keep your worktree as it is.
- End with only this JSON:

```json
{"status": "merged" | "needs_input" | "blocked", "pr": "<url or null>", "branch": "...", "worktree": "<absolute path>", "tasks": {"done": ["<id>"], "not_done": [{"id": "...", "reason": "..."}]}, "summary": "<2-4 sentences: what changed, clients covered, verification>", "questions": "<for needs_input/blocked>", "followups": [{"title": "...", "description": "...", "type": "bug" | "feature", "relatedTaskId": "..."}]}
```
