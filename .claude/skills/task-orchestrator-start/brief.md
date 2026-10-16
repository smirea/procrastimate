# How to work

You own this job end to end, through the merge. Stefan authorized you to merge your PR without asking.

## Setup

- First command: `bun scripts/setup-worktree.ts <branch>`, with a short `t3/<topic>` branch name. It renames your branch, writes offline env files with an in-memory database and your own ports, and writes `./sim`. Never rename the branch again.
- Never `env-manager up`/`down`, never copy the main `.env.local` (it points at the shared dev database), and never touch the main checkout or another worktree's servers or simulators.
- Plain `bun run start` signs in against the in-memory auth database. E2E tests sign in on their own.

## iOS

- `./sim --no-watch` builds, installs, and launches the app headless on your worktree's own simulator. `./sim` without `--no-watch` keeps watching and relaunches on save. `--show` opens it in Device Hub, which you never need.
- Verify iOS UI with `./sim test <file.swift>... [--only Class/test] [--keep]`. It builds and installs the app, then runs throwaway XCUITests from your files against it, under a time limit. In each test, start the app with `launchApp(demo:reset:environment:)` and save screenshots with `shot("name")`; both come from the generated `Support.swift`. Write the test files outside the repo. Never build your own XCUITest project in `/tmp`.
- `xcrun simctl io $(./sim udid) screenshot <file>.png` captures the screen. You have no `device_open`; agent device access is off.
- Run `./sim stop` as soon as you are done with iOS, before you open the PR. `./sim test` stops the simulator after each run unless you pass `--keep`.

## Shell

- Stop every server you start, by its pid. Never `pkill -f` a pattern another worktree could match.
- macOS has no `timeout`. Don't chain `sleep` before another command, because a hook blocks it. Wait on PRs with `scripts/pr-ship.ts` instead.
- Git hooks can't be skipped (a Claude Code hook blocks it). A failing hook gets its cause fixed, in this PR or as a followup. A flaky test is a bad test: fix why it flakes, and never add retries or sleeps.

## PR

- Open one PR whose description starts with a `# Tasks being addressed` section that lists each task's content and public read-only link.
- Then loop `bun scripts/pr-ship.ts --merge` in the foreground with a 600000 ms tool timeout, and act on its exit code:
  - `0`: merged.
  - `1`: fix the failing checks, or fix or answer each review thread and resolve it. Then push and rerun.
  - `2`: rebase onto `origin/master`, push, rerun.
  - `3`: rerun.
- Never end your turn while the PR is open: nothing wakes you afterwards. Treat review-bot comments skeptically. Fix real bugs, and dismiss noise with a concrete reason in your reply.
- Migrations: never run an unmerged migration against a shared database. A database whose history isn't a prefix of the code's refuses to migrate, which locks it for master. Two migration PRs conflict in `server/drizzle/meta/_journal.json`. The PR that merges second deletes its migration, rebases, and reruns `bun run db:generate`. Never hand-merge the journal.

## Scope and report

- Note bugs, weird interactions, bad UX, jank, or performance issues you find along the way as followups instead of fixing out-of-scope work. Report only real bugs and clearly useful gaps, not every edge case you can imagine.
- Don't message the orchestrator mid-job. If you need input, end with `needs_input`, and keep your worktree as it is.
- End with only this JSON:

```json
{"status": "merged" | "needs_input" | "blocked", "pr": "<url or null>", "branch": "...", "worktree": "<absolute path>", "tasks": {"done": ["<id>"], "not_done": [{"id": "...", "reason": "..."}]}, "summary": "<2-4 sentences: what changed, clients covered, verification>", "questions": "<for needs_input/blocked>", "followups": [{"title": "...", "description": "...", "type": "bug" | "feature", "relatedTaskId": "..."}]}
```
