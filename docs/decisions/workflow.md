# Workflow

- **One PR per thread, never stacked.** Each thread ships one PR off `master`.
- **Fold small follow-ups in.** Before starting a new thread for new work, consider folding it into an existing open PR or thread when it touches the same area or files or is a small follow-up. Start a new thread only when the work is genuinely independent.
- **Rebase only on a real conflict.** Rebase a PR only when GitHub reports a conflict. PR CI already tests the merge with `master`, so do not rebase every open PR after each merge.
- **Decisions live one file per area.** Each area of `docs/decisions/` is its own file, so parallel PRs don't conflict. Record a decision in the matching area file, and add a new file when no area fits.
- **Workers build features themselves.** Never hand the whole build to a helper sub-agent that can't receive messages.
- **Run only the relevant tests locally.** Run the unit and e2e specs that cover the change. The full suite runs in CI.
- **Screenshots only for UI changes.** Attach 2 to 4.

## Clients

- **Every feature is built for all clients at once.** Web and iOS today. A feature request is planned and built for every client where it makes sense, not for one client with the others catching up later.
- **Each feature plan names its clients.** It lists the target clients and says why any are excluded. Some clients get a subset; a future Apple Watch app, for example, gets only what suits a watch.
- **Web and iOS slices are planned together.** Shared logic lands once in `shared/` with its Swift port through the test vectors. Each UI slice has a twin on the other client, written against the same parity ids, and every UI scenario gets a paired Playwright and XCUITest test (see [iOS app](ios.md#build-and-verification)). The twins may run as parallel PRs.
