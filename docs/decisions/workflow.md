# Workflow

- **One PR per thread, never stacked.** Each thread ships one PR off `master`.
- **Fold small follow-ups in.** Before starting a new thread for new work, consider folding it into an existing open PR or thread when it touches the same area or files or is a small follow-up. Start a new thread only when the work is genuinely independent.
- **Rebase only on a real conflict.** Rebase a PR only when GitHub reports a conflict. PR CI already tests the merge with `master`, so do not rebase every open PR after each merge.
- **Decisions live one file per area.** Each area of `docs/decisions/` is its own file, so parallel PRs don't conflict. Record a decision in the matching area file, and add a new file when no area fits.
- **Workers build features themselves.** Never hand the whole build to a helper sub-agent that can't receive messages.
- **Run only the relevant tests locally.** Run the unit and e2e specs that cover the change. The full suite runs in CI.
- **iOS CI runs only where the app can change.** The macOS `core` (`swift test`) and `app` (API URL and build checks) jobs in `.github/workflows/ios.yml` run on a pull request whose diff touches `app-ios/`, `shared/`, the Swift generator, or the other inputs its `changes` job lists, and on a manual `workflow_dispatch`. They skip `master`, since TestFlight archives every such merge. The Linux `core-linux` job runs `swift test` on every pull request and push. A job skipped by `if` reports success, so a required check of that name does not block the merge.
- **Screenshots only for UI changes.** Attach 2 to 4.

## Clients

- **Every feature is built for all clients at once.** Web and iOS today. A feature request is planned and built for every client where it makes sense, not for one client with the others catching up later.
- **Each feature plan names its clients.** It lists the target clients and says why any are excluded. Some clients get a subset; a future Apple Watch app, for example, gets only what suits a watch.
- **Web and iOS slices are planned together.** Shared logic lands once in `shared/` with its Swift port through the test vectors. Each UI slice has a twin on the other client. Automated UI pairs are not part of the suite; parsers, vectors, and the auth and sync smoke are ([Testing](testing.md)). The twins may run as parallel PRs.

## Parallel agents

- **Every agent worktree is sandboxed by script.** `scripts/setup-worktree.ts` gives it its own ports (a git-ignored `.env.override` that env-manager applies to every target), an in-memory database, and a git-ignored `./sim` bound to its own simulator. `scripts/teardown-worktree.ts` removes all of it from the main checkout once the PR is merged. The simulator is named after the branch, or after the worktree directory on a detached HEAD, and teardown reads the name back from `./sim`. A permission alert raised before the launcher granted permissions survives later grants and relaunches, so `./sim` reboots its own simulator once if it is booted without the marker file in its data directory. Every launch after that is already granted. Rules that a script can enforce live in the script, not in prompts.
- **CI pins env-manager and fails on reader drift.** `.github/actions/setup/action.yml` pins the env-manager commit that Stefan's machine runs from `~/code/env-manager`. CI fails when `env-manager gen --local` changes any tracked file, so a reader-format change gets a pin bump and the regenerated readers committed together.
- **Git hooks are never skipped.** A Claude Code hook in `.claude/settings.json` blocks `--no-verify` and lefthook overrides. A failing hook gets its cause fixed; a flaky test is a bad test.
- **The orchestrator runs jobs as T3 child tasks.** `task-orchestrator-start` launches each job with `delegate_task` in its own worktree, so Stefan sees one thread instead of one per job. Each child owns its job through the merge: it babysits its PR with `/pstack:babysit` and merges it itself. Migration PRs serialize on their own because they conflict in the drizzle journal. A child reports to the orchestrator only when it finishes or needs input.
