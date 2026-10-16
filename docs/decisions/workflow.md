# Workflow

- **One PR per thread, never stacked.** Each thread ships one PR off `master`.
- **Fold small follow-ups in.** Before starting a new thread for new work, consider folding it into an existing open PR or thread when it touches the same area or files or is a small follow-up. Start a new thread only when the work is genuinely independent.
- **Rebase only on a real conflict.** Rebase a PR only when GitHub reports a conflict. PR CI already tests the merge with `master`, so do not rebase every open PR after each merge.
- **Decisions live one file per area.** Each area of `docs/decisions/` is its own file, so parallel PRs don't conflict. Record a decision in the matching area file, and add a new file when no area fits.
- **Workers build features themselves.** Never hand the whole build to a helper sub-agent that can't receive messages.
- **Run only the relevant tests locally.** Run the unit and e2e specs that cover the change. The full suite runs in CI.
- **iOS tests are off in CI until a release.** The macOS `core` and `app` jobs (XCUITests) do not run on pull requests or on `master`. They stay in `.github/workflows/ios.yml` and run only from a manual `workflow_dispatch`, which is how they are turned back on before a release. The Linux `core-linux` job still runs `swift test` on every pull request and push. A job skipped by `if` reports success, so a required check of that name does not block the merge.
- **Screenshots only for UI changes.** Attach 2 to 4.

## Clients

- **Every feature is built for all clients at once.** Web and iOS today. A feature request is planned and built for every client where it makes sense, not for one client with the others catching up later.
- **Each feature plan names its clients.** It lists the target clients and says why any are excluded. Some clients get a subset; a future Apple Watch app, for example, gets only what suits a watch.
- **Web and iOS slices are planned together.** Shared logic lands once in `shared/` with its Swift port through the test vectors. Each UI slice has a twin on the other client. Automated UI pairs are not part of the suite; parsers, vectors, and the auth and sync smoke are ([Testing](testing.md)). The twins may run as parallel PRs.

## Parallel agents

- **Every agent worktree is sandboxed by script.** `scripts/setup-worktree.ts`, which T3 Code runs on every new worktree, gives it its own ports (a git-ignored `.env.override` that env-manager applies to every target), an in-memory database, and a git-ignored `./sim` bound to its own simulator. `scripts/teardown-worktree.ts` removes all of it from the main checkout once the PR is merged. Rules that a script can enforce live in the script, not in prompts.
- **Git hooks are never skipped.** A Claude Code hook in `.claude/settings.json` blocks `--no-verify` and lefthook overrides. A failing hook gets its cause fixed; a flaky test is a bad test.
- **The orchestrator runs jobs as T3 child tasks.** `task-orchestrator-start` launches each job with `delegate_task` in its own worktree, so Stefan sees one thread instead of one per job. The orchestrator watches every job's PR, forwards failures to the child, and does all merging itself, which also serializes migrations.
