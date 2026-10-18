# Scripts, generators, CI, and tooling review

Scope (line counts): scripts/generate/{swift.ts 897, tables.ts 177, index.ts 84, tokens.ts 83, zod.ts 72, openapi.ts 69, models.ts 34, migrations.ts 21, preload.ts 3, css.d.ts 4}; scripts/{sync-smoke.ts 312, sim-uitest.ts 228, local-stack.ts 210, sentry-check.ts 206, pr-ship.ts 162, setup-worktree.ts 156, feature-map-citations.ts 113 (+test 16), teardown-worktree.ts 101, testflight-processed.js 96, worktree-gc.ts 83, test-changed.ts 75, worktree-sim.ts 75, sentry-ios-smoke.ts 65, simulators.ts 43, wrangler-dev.ts 34, env.ts 25, ci-stack.ts 24, test-guard.ts 22 (+test 27), app-version.mts 20, sentry-release.mts 12}; server/scripts/{secrets.ts 344 (+test 89), ramble-latency.ts 283, migration-history.ts 81 (+test 57)}; app-web/scripts/{verify-push.ts 191, icons.ts 79}; app-ios/scripts/{run 258, archive 87, parity-report.ts 59, todoist-fixtures.ts 60, parity-attachments.ts 30, generate 19, test 6}; lefthook.yml 21; .github/workflows/{ci.yml 218, ios.yml 178, testflight.yml 138, testflight-processed.yml 44}; .github/actions/setup/action.yml 22; wrangler.jsonc; package.json (3); tsconfig.json (root, server, app-web); drizzle.config.ts; .env schema. There is no oxlint/oxfmt config file; both run with defaults. Decision docs read: workflow.md, testing.md, plus the generator sections of api.md and ios.md, and observability.md's smoke rule.
Commit: ad9437e
Method: Read every file in scope in full. Ran `bun scripts/generate/index.ts` (0.09 s, idempotent) and `bunx --bun tsc --noEmit -p .` (clean, 1.4 s). Wrote scratch probes in /tmp: (1) a dry-run copy of test-changed.ts that prints its selection without running tests (`/tmp/test-changed-dry.ts`), (2) an import-graph prototype of the same selection (`/tmp/test-graph.ts`), (3) direct calls into `swiftModule()` with hand-made schemas (`/tmp/probe-swift.ts`, `/tmp/probe2.ts`), (4) a walk of `namedSchemas()` to list the JSON Schema keywords the shared schemas actually emit. Ran `sentry-check.ts --expect web,worker,account` with no token (it fails before any network call). Ran the dependency grep through `/tmp/deps.sh`. Did not run anything that touches Docker, simulators, AWS, GitHub, or Cloudflare. For worktree-gc I only confirmed that `git worktree list` exits 128 outside a repo.

## Verdict

The slice is in decent shape. Most scripts fail early with a message that names the fix. The Swift generator is built sensibly: it lowers schemas into a closed `Decl` union, and one exhaustive switch renders each kind. Two things matter most. First, the git-hook test selector (`test-changed.ts`) matches basenames against string literals. It routinely skips the tests that cover a change (a change to `server/src/app.ts` selects zero tests) and runs unrelated ones, so the pre-commit and pre-push gates are much weaker than testing.md implies. Second, `worktree-gc.ts` treats a failed `git worktree list` as "no worktrees exist". Run from outside the repo, it would delete every agent's simulators, PowerSync containers, and databases. After those come the Swift generator's silent paths (constraints it drops without a word, and invalid Swift identifiers), duplicated process and dotenv helpers across about eight scripts, three unused dependencies, and about 250 lines of dead scripts and workflows.

## Findings (most important first)

### F1. The hook test selector misses the tests that cover a change and picks unrelated ones [bug] [CONFIRMED] [effort: S]

`scripts/test-changed.ts:51-58` reduces each changed file to its basename. It then selects every test whose source contains any string literal ending in that name (`['"\`][^'"\`]*${name}(?:\.ts)?['"\`]`). It skips names in `skipImportNames` (`index`, `testing`, `types`, `mod`, `app`, `env`) and names shorter than 3 characters. The selection is never transitive, and two modules with the same basename collide. I ran a dry-run copy that prints the selection instead of running `bun test`:

- `server/src/app.ts`: **no tests**, because `app` is in the skip list. Yet `server/src/test-app.ts:9` imports `createApp` from it, and all 15 server route tests go through `testApp()`.
- `server/src/access.ts`: selects `shared/screens.test.ts` and `shared/local-rows.test.ts`, which only contain the word `access` in a string or comment. It misses `upload.test.ts`, `sync.test.ts`, `push.test.ts`, and the other route tests that exercise it.
- `server/src/db/postgres.ts`: selects `scripts/test-guard.test.ts`, because that test has the literal `'postgres://u:p@localhost:5432/app'`.
- `shared/rows.ts`: 4 tests (rows, scope, views, local-rows). It misses the 12 server tests that reach it through the upload path.
- `scripts/generate/swift.ts` or any `shared/` file: never sets `ios`, so `swift test` does not run. ios.yml (line 42) and testflight.yml (line 79) both treat these paths as changes to the app.

testing.md says the hook runs "the colocated `*.test.ts` and any unit test that imports the changed module". The regex does not implement that. It matches text. Remedy: build the reverse import graph with `Bun.Transpiler.scanImports` and take the transitive closure from the changed files. The 40-line prototype at `/tmp/test-graph.ts` resolves relative, `shared/*`, and `#lib/*` specifiers. It selects all 15 server tests for `app.ts` and for `server/src/access.ts`, 16 tests for `shared/rows.ts`, and nothing spurious, all in well under 100 ms. That removes `skipImportNames`, the length guard, and the regex. Set `ios` from the same path list ios.yml uses (`app-ios/`, `shared/`, `scripts/generate/`, `app-web/src/index.css`). Svelte files need `svelte/compiler`'s parse or a `<script>` extraction before the scan, or they can keep the colocated-test rule. The visible behavior stays the same: the hook still runs only related unit tests, and only the selection changes. Wider selection costs a few seconds on PGlite. If pre-commit gets too slow, keep the closure for pre-push only.

### F2. worktree-gc deletes every worktree's simulators, containers, and databases when `git` fails [bug] [CONFIRMED by trace] [effort: S]

`scripts/worktree-gc.ts:20-23` defines `run()` to return `''` on any non-zero exit. Line 30 builds `worktrees` from `run(['git', 'worktree', 'list', '--porcelain'])`, and line 37 builds `live` from that. If git fails, `live` is empty. Then:

- line 48 deletes every claimed simulator ("its worktree is gone"),
- line 68 removes every labelled PowerSync container,
- line 74 drops every database whose comment names a worktree, `_powersync` twin included (`local-stack.ts:97-101`).

Git fails whenever the script runs outside a checkout. `cd /tmp && git worktree list --porcelain` exits 128 ("not a git repository"). The header promises "Safe to run any time, from any checkout", and the orchestrator runs it on every wake. Note also that `worktreeDatabases().catch(() => [])` at line 73 hides connection errors. Remedy: use a throwing `run` for git (the shared helper from F5) and resolve the repo from `import.meta.dir` (`git -C <repo>`), not from the cwd. Keep the forgiving variant only for `plutil` and `gh`, where an empty answer really means "skip". Behavior is unchanged in the normal case.

### F3. The Swift generator drops constraints without a word, and can emit Swift that does not compile [robustness] [CONFIRMED] [effort: S]

On structure, which the brief asked about: `swift.ts` is not a nest of conditionals. It lowers schemas into a closed `Decl` union (lines 89-96). `renderDecl` switches over it exhaustively, and `condition` and `rule` switch over a closed `Check` union. The only cascade is `type()` (208-227) together with `component()` and `union()`, and its order is meaningful. Keep the structure. Its "fails loudly" promise (lines 3-5: "Anything else fails the run") has three gaps. I confirmed each with probes that call `swiftModule()` directly:

1. **Unknown keywords are ignored.** `ownChecks` (237-258) reads `minimum`, `maximum`, the exclusive bounds, `minItems`, `pattern`, numeric `enum`, and `x-validate`. Everything else falls through. The shared schemas today emit `minLength` 4 times (`ImageRef.id`, `PushSubscription.keys.p256dh` and `.auth`, `MemoTaskInput.title`), `maxLength` 8 times (the `Client` and `ClientStamp` fields), `format` once, and `maxItems`, `prefixItems`, and `propertyNames` twice each. The generated `ImageRef` checks `width > 0` and `height > 0` under `decoder.validates` but never checks `id`'s `minLength: 1`. `APIClient.swift:50` decodes every response with `JSONDecoder.validating()`, so it accepts an empty `ImageRef.id` that Zod's `safeParse` rejects. That contradicts the header's "fails like `safeParse` does".
2. **Untyped fallbacks.** Line 225 returns `JSONValue` for any bare `{type:'object'}` and for any schema whose only key is `description`. `openapi.ts:59` passes `unrepresentable: 'any'`, so `z.date()`, `z.bigint()`, and `z.custom()` all become `{}` and then silently become `JSONValue`. Probe: `date {} -> JSONValue`, `custom {} -> JSONValue`, `bigint {} -> JSONValue`. A tuple without `x-swift-type` becomes `[JSONValue]`. Only `UploadRequest.writes` and `UploadWrite.values` rely on this on purpose today.
3. **Invalid identifiers.** `KEYWORDS` (98-112) lists 13 words. Probe: a property `for` emits `public var for: String`, and enum values `24h`/`7d` emit `case 24h = "24h"`. Both are Swift compile errors that surface in Xcode, not in `generate`. An enum value with no alphanumerics (`+`) crashes `camel()` with `TypeError: undefined is not an object`, so the friendly `Add x-enum-names...` guard at line 471 is unreachable.

Remedy, all in swift.ts:

- Assert every node's keys against a `HANDLED` set (the `Schema` type's keys plus `readOnly`, `title`, `$defs`) and throw on the rest. This turns gap 1 into a loud error.
- Add a `{ kind: 'length'; min?: number; max?: number }` check, since the doc already promises it enforces "sizes".
- Replace the line-225 fallback with an explicit opt-in (`x-swift-type: 'JSONValue'` on the two upload schemas) and switch `unrepresentable` to `'throw'`.
- Make `identifier()` validate `/^[A-Za-z_]\w*$/` and backtick a complete Swift keyword list, throwing for anything that is still invalid.

Generated output stays byte-identical for today's schemas, apart from the added length checks.

### F4. The documented Sentry check command fails because `account` no longer exists [bug] [CONFIRMED] [effort: S]

The root AGENTS.md (Sentry section) tells agents to run `bun scripts/sentry-check.ts ... --expect web,worker,account[,ios]`. The docstring of `scripts/sentry-ios-smoke.ts:9` says `--expect ios,worker,account`. `SMOKES` in `sentry-check.ts:23-27` has only `web`, `worker`, and `ios`, and observability.md records that "The `Account` object's smoke route went with the object". Running the documented command throws at `sentry-check.ts:37`: `--expect takes web, worker, ios, not "account"`. Remedy: drop `account` from both places. The documented command becomes runnable again and the script does not change.

### F5. Process, dotenv, and worktree-list helpers are duplicated across about eight scripts [simplification] [CONFIRMED] [effort: M]

- **Process wrappers:** `run()` is written separately in local-stack.ts:46, setup-worktree.ts:20, teardown-worktree.ts:13, worktree-gc.ts:20 (the swallowing variant behind F2), pr-ship.ts:23, secrets.ts:152, and sentry-ios-smoke.ts:27. sim-uitest.ts:35 has an inner one, and simulators.ts:12 has `simctl`. Each differs only in stdio and whether it may fail.
- **Dotenv parsing:** five ad-hoc parsers: `parseDotenv` (secrets.ts:99, the only tested one), `readOverride` (local-stack.ts:200), `readPort` (setup-worktree.ts:55, a regex for `CLIENT_PORT`), teardown-worktree.ts:53-55 (the same regex again), and setup-worktree.ts:129 (a regex for `DATABASE_URL` in `server/.env.local`).
- **Worktree listing:** `git worktree list --porcelain` is parsed in teardown-worktree.ts:30, worktree-gc.ts:30, and setup-worktree.ts:77, three ways.

Remedy: one `scripts/lib.ts` holding `run(cmd, { allowFail?, stdio? })`, `worktrees(): { path, branch? }[]`, and `parseDotenv`, moved there from secrets.ts with its test. Then `readOverride(w)?.CLIENT_PORT` replaces both port regexes. That removes about 60 lines and three regex parsers. The behavior is the same, because every call site keeps its own throw-or-allow choice explicitly.

### F6. Three unused dependencies and split tool versions [simplification] [CONFIRMED] [effort: S]

`git grep` over every .ts/.mts/.js/.svelte/.css/.json file outside the package.json files and bun.lock finds no use of `lodash`, `es-toolkit`, or `kill-port-process`. Each name appears only in root package.json:46-49. So neither lodash nor es-toolkit is used; remove all three. Other hygiene points:

- `typescript` is `^7.0.2` at the root and `^6` in app-web. Root `check` runs TS 7 through `bunx --bun tsc`, while `app-web check` runs `tsc -p src/service-worker` on TS 6.
- `@sentry/cli` is pinned twice: devDependency `3.8.0`, and `bunx @sentry/cli@3.8.0` in app-ios/scripts/archive:78. The archive script can call `bunx sentry-cli` as ci.yml does, so the lockfile is the single source.
- `@orpc/*` and `drizzle-orm` are declared in both root `dependencies` and app-web `devDependencies` at the same versions. One declaration at the root suffices with workspaces.

### F7. About 250 lines of dead scripts and a one-off workflow [simplification] [CONFIRMED by grep] [effort: S]

- `app-ios/scripts/parity-report.ts` (59) and `parity-attachments.ts` (30). No workflow job or script calls them. ios.yml has no `web-parity`/`parity-report` jobs (only the old plan in docs/ios-parity.md mentions them). The `snap` helper they rely on no longer exists, and testing.md says there is no XCUITest target.
- `app-ios/scripts/todoist-fixtures.ts` (60). Its header says it writes files for "the import XCUITests", which do not exist. Nothing references it, and the Todoist import docs say the e2e tests zip the fixture in memory.
- `.github/workflows/testflight-processed.yml` (44) and `scripts/testflight-processed.js` (96). A debugging workflow: a push of the file checks the hard-coded build `2026.1013.215734`, and the JS falls back to a hard-coded app id `6821643485`. It is the only CommonJS/Node script in a Bun repo. Product question: if a manual "wait until processed" check is still wanted, keep `workflow_dispatch` with a required input, drop the push trigger and both hard-coded fallbacks, and port the script to TS.

Deleting the parity and fixture scripts changes no behavior, since nothing invokes them.

### F8. Lefthook's two fixers rewrite the same files in parallel, and typecheck runs on every commit [robustness] [PLAUSIBLE] [effort: S]

lefthook.yml:2 sets `parallel: true`. `oxlint --fix {staged_files}` and `oxfmt {staged_files}` both rewrite the same staged files with `stage_fixed: true`, at the same time. When oxlint has a fixable finding, the two read-modify-write cycles can interleave, and one tool's edit can overwrite the other's. The `test` command also reads those files while they are being rewritten. Separately, `typecheck: run: bun run check` has no glob, so a docs-only or Swift-only commit still runs generate, tsc, `svelte-kit sync`, svelte-check, and the service-worker tsc. Remedy: one sequential command, `bunx oxlint --fix {staged_files} && bunx oxfmt --no-error-on-unmatched-pattern {staged_files}`, with `stage_fixed`. Give typecheck `glob: '*.{ts,mts,js,svelte}'`. The same checks still run, just in order and only when relevant.

### F9. A master push whose deploy was skipped still shows green [robustness] [PLAUSIBLE, product question] [effort: S]

ci.yml:149 computes `HAS_CLOUDFLARE` from the secrets. Every deploy step is gated on it, and when it is false the job ends with `::warning::Not deployed` (line 216) and succeeds. AGENTS.md says "CI deploys every push to `master`". This repo has one owner and one production, so a missing or rotated-away secret should fail the push loudly, the same way the Sentry-token step already does (line 160). Remedy: replace the warning step with `exit 1`. The only behavior that changes is a green build that never deployed.

### F10. pr-ship reports any `gh` failure as "no PR", and a bad `--budget` loops forever [robustness] [CONFIRMED by reading] [effort: S]

`scripts/pr-ship.ts:58-66`: `view()` catches every error from `gh pr view` and exits 1 with "This branch has no PR. Push it and open one". An expired `gh` login, a network blip, or a rate limit all send the agent to open a duplicate PR. Exit 1 means "something to fix" in the script's own protocol. Remedy: catch only `gh`'s "no pull requests found" message and rethrow the rest. Also, `Number(values.budget)` on a non-numeric value gives `NaN`. Then `Date.now() + POLL_MS > NaN` is never true, so the 600-second tool-limit guard never fires. Validate the value with `Number.isFinite` at startup.

### F11. Two Drizzle column-type tables, and api.md disagrees with one of them [simplification] [CONFIRMED] [effort: S]

`scripts/generate/zod.ts:12-19` (`BY_TYPE`) and `scripts/generate/tables.ts:16-22` (`KIND`) both map Drizzle `columnType` strings, and they already disagree. `PgBoolean` and `PgBigSerial53` are only in the Zod table; `PgJsonb` is only in `KIND`. api.md:11 says client tables store "booleans and integers as `integer`", but `syncedTables()` throws `PowerSync has no type for PgBoolean` on the first boolean synced column. There are none today. Remedy: one `COLUMN_TYPES: Record<string, { zod?: string; local: Kind }>` that both files read, with `PgBoolean: { zod: 'z.boolean()', local: 'integer' }`. Alternatively, drop booleans from api.md. In the same pass, `zodModule` and `tableDefaults` filter the schema's `PgTable` exports with the same code twice (zod.ts:24 and 59). Output is unchanged.

## Smaller notes

**test-guard and IPv6.** `scripts/test-guard.ts:14` compares `hostname` to `'::1'`, but WHATWG URLs keep the brackets (`new URL('postgres://u:p@[::1]:5432/x').hostname === '[::1]'`, checked with `bun -e`). A local IPv6 `DATABASE_URL` is refused. It fails safe; add `'[::1]'`, and add the case to `test-guard.test.ts`.

**sync-smoke leaves its forged access row behind.** `scripts/sync-smoke.ts:282-294`: `check()` calls `process.exit(1)` inside the `try`, and `process.exit` skips `finally`. If either forged-row check fails, a forged `access` row that gives `other` edit on `victim`'s task stays in the worktree database. Let `check` throw, and exit at the top level instead. `upload` (171) is `uploadAs(owner, …)`, and the stream-open block (155-168 and 200-212) is written twice.

**verify-push looks stale.** `app-web/scripts/verify-push.ts:50-53` reads `deviceId` from the `procrastimate` localStorage document. The app now deletes that key on load (`device.ts:12-18`, `forgetLegacyDocument()` from `store.svelte.ts:138`), so the script sends an empty `x-procrastimate-device` header. It also hard-codes the header name rather than importing `DEVICE_HEADER`. I did not run it (it needs Chrome and FCM).

**local-stack swallows replication errors.** `local-stack.ts:144`: `.catch(() => [])` on the replication query hides auth and connection errors for 60 s, then reports "did not start replicating". Catch only "relation does not exist".

**setup-worktree prints the wrong container name.** `setup-worktree.ts:153` prints `procrastimate-powersync-${basename(root)}`, but the container is named with `worktreeKey(root)`, which sanitizes. They differ only for directory names with unusual characters.

**The iOS path list exists three times.** The "touches the app" list is in testflight.yml `paths:` (15-23), the testflight debounce grep (79), and the ios.yml `changes` grep (42), each with its own workflow file appended. A `scripts/app-paths.txt` read by both greps would leave `paths:` as the only copy that has to be maintained by hand (Actions cannot read a file there). test-changed.ts (F1) wants the same list.

**The watch loop hashes all of Sources.** `app-ios/scripts/run:107-122`: watch mode hashes the full contents of `Sources`, `Config`, and the project every 750 ms (167 files, 1.6 MB). It also hashes `Sources/**/Generated`. If the first `deploy()`'s generate step rewrites a generated file, the next poll sees a change and rebuilds once more. Skip `Generated` directories and compare mtime and size before hashing.

**Leftover Turso keys.** `.env:57-59` keeps `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` "Delete both after it". docs/postgres-powersync.md:103 schedules that for a week after the cutover, and README.md:32 still lists Turso secrets as required Worker secrets (outside this slice). Open a follow-up once the cutover week passes.

**Shared tests run twice in CI.** ci.yml runs `bun test` (line 57), then `bun run vectors`, which is `bun test shared` again in record mode. The record run is a full test run, so running `vectors` first and then `bun test server app-web scripts` would cover the same tests once. The saving is small (seconds).

**`!` assertions with the strict flag off.** The root tsconfig leaves `noUncheckedIndexedAccess` commented out ("annoying"), yet the scripts use `!` on nearly every index access (`match[1]!`, `parts[0]!`). Either turn the flag on, which makes those `!` meaningful, or stop writing them. This adds reader load, not bugs.

**Bun versions.** CI pins Bun 1.4.3 in four places (setup action, ios.yml twice, testflight.yml). The local runtime here is 1.4.0, and no `packageManager` or `engines` field pins it for developers.

## Test coverage observations

- `test-changed.ts` has no test. A table test that maps a changed path to its selected tests would have caught F1 (`app.ts` selecting nothing). Once the selector is a pure `select(changed, graph)`, that test is cheap.
- `swift.ts` has no TS-side test. Coverage is indirect: `APITests` and `VectorTests` in app-ios check the generated output for today's schemas, which cannot catch gaps 1-3 of F3, because no current schema triggers them visibly. A few `swiftModule({ components: {...} })` cases that expect a throw (unknown keyword, keyword identifier, `{}`) would lock in the "fails the run" promise.
- `test-guard.test.ts` tests behavior with literal expectations; it lacks the IPv6 case.
- `secrets.test.ts` and `migration-history.test.ts` are good behavior tests (literal inputs, literal results).
- worktree-gc, teardown-worktree, setup-worktree, local-stack, and pr-ship have no tests. Their decision logic (which resources count as orphaned, which exit code to return) is pure and could be separated from the side effects: `orphans(worktrees, devices, containers, databases)` would test F2's empty-list case directly.
- `feature-map-citations.test.ts` tests the real repo state, which is the intended use.
