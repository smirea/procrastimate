# Test suites review

Scope: every `shared/*.test.ts` (31 files, 6,941 lines incl. `quick-add.test.ts` 1,295, `store.test.ts` 620, `task.test.ts` 457, `todoist.test.ts` 404), `server/src/*.test.ts` (19 files, 2,815 lines), `server/src/test-app.ts` (173), `shared/testing.ts` (61), `shared/vectors/record.ts` (105), `app-web/e2e/*.e2e.ts` (30 specs, 3,326 lines incl. `sync` 576, `projects` 258, `layout` 231, `sharing` 222), `app-web/e2e/fixtures.ts` (378), `app-web/playwright.config.ts` (91), `scripts/test-changed.ts` (75). I also skimmed `server/src/db/*.test.ts`, `bunfig.toml`, `scripts/test-guard.ts`, `scripts/generate/preload.ts`, and `.github/workflows/ci.yml`.
Commit: ad9437e
Method: I read every file in scope. I ran `bun test shared` (1509 pass, 0 fail, 228 ms in-runner, 0.235 s wall) and `bun test server` (123 pass, 2 skip, 0 fail, 8.76 s in-runner, 8.78 s wall), then timed each server file on its own. I wrote scratch tests under `/tmp/t09/`:

- a memo-tasks repro on the real test app;
- PGlite timings (migrate vs `clone()`);
- a copy of `test-changed.ts`'s selection logic, run on sample paths;
- a 200k-sample check of `images.e2e.ts` titles against `parseQuickAdd`;
- a probe for Bun's current-test-name API.

I did not run e2e. About 40% of the time went to the shared and server suites, 35% to e2e, and 25% to the infrastructure scripts and the scratch checks.

## Verdict

The unit suites are in good shape. Almost every shared and server test calls the real function or route and asserts a literal value. The `recorded(...)` vector mechanism is small and justified: I checked that Bun exposes no current test name, so the `describe` and `test` wrappers are needed. The server tests drive the real `handle` on PGlite. The two problems that matter most:

1. The only tests of the sharing advisory lock are skipped in every run, locally and in CI.
2. The pre-commit selector in `scripts/test-changed.ts` matches string literals, not imports, so a change to `server/src/writes.ts` runs one server test file out of 13.

The rest is cleanup:

- one memo-tasks test asserts the opposite of its title;
- one dictation test proves nothing about dictation;
- e2e specs repeat vector cases, which `testing.md` forbids;
- a 20-line `Task` factory is copied into 10 files;
- `layout.e2e.ts` sleeps.

## Findings (most important first)

### F1. The share-lock race tests never run anywhere [robustness] [CONFIRMED] [effort: S]

`server/src/sharing-lock.test.ts:54` and `:91` are `test.skipIf(!process.env.DATABASE_URL)`. The 2 skips in my `bun test server` run are these tests.

They are skipped everywhere:

- `bun test` does not load `.env.override`, so they skip locally.
- CI's `Unit tests` step (`ci.yml:56-57`) sets no `DATABASE_URL`, so they skip there too.
- The only job with a Postgres is the e2e job, which gets it from `scripts/ci-stack.ts:20` writing `.env.override`, and that job runs only Playwright.

So the two `sharing.md` guarantees these tests exist for have no running test:

- a share change waits for the space lock an upload holds;
- a guest write re-checks access that a downgrade is still changing.

`testing.md` also says "the tests themselves never read it [DATABASE_URL]", which this file contradicts.

Remedy:

1. Add a step to the e2e job after `ci-stack.ts`: `DATABASE_URL=$(grep ^DATABASE_URL= .env.override | cut -d= -f2-) bun test server/src/sharing-lock.test.ts`.
2. Make a skip in CI fail loudly: `if (process.env.CI && !url) throw new Error(...)`.

While there, two cleanups:

- The 500 ms `Promise.race` against `Bun.sleep` (`:77`, `:114`) is the one timing-based proof in the server suite. It can be replaced by waiting on the condition itself: poll `select count(*) from pg_locks where locktype = 'advisory' and not granted` on the holder connection until it is 1. That proves the request is blocked on the lock instead of merely being slow.
- `postgresApp()` (`:20-39`) re-implements `testApp`'s app, fetch, and close wiring. A `testApp({ db })` option removes 15 lines.

### F2. "a task the user deleted from the app stays gone too" asserts that it comes back [bug] [CONFIRMED] [effort: S]

`server/src/memo-tasks.test.ts:64-70` deletes a memo task through `/api/upload`. It then PUTs the same `key` under a new `memoId` (`crypto.randomUUID()`) and expects `['Water plants']`. The source key is `voicememo:<memoId>:<taskKey>` (`integrations.md` line 16), so a different `memoId` is a different task. The test therefore proves "a different memo makes a new task", the opposite of its title.

The behavior the title names ("never brings back one Stefan deleted", `integrations.md:22`), an app-side delete followed by a resend of the same memo, has no test. The existing test 3 covers only `DELETE /api/memo-tasks`.

I ran the real scenario in `/tmp/t09/memo.test.ts` (same `memoId`, app delete, PUT again). It returns `[]`, so the server is correct and only the test is wrong. Fix: reuse the first memo's `memoId` and expect `[]`.

Two related problems in the same file:

- Test 3 (`:54-62`) depends on test 1's state: `list()` must return 2 tasks, and `expect(tasks).toHaveLength(2)` sits after the deletes. Running it alone with `-t` fails. It should create its own memo.
- In `upload.test.ts:426-458`, `ALTER TABLE tasks ADD CONSTRAINT refused` is undone only on the happy path. A failure leaves the constraint on the shared database for the rest of the file. Wrap it in `try/finally`.

### F3. `test-changed.ts` selects tests by string-literal match, so the hooks skip most real dependents [robustness] [CONFIRMED] [effort: S]

`scripts/test-changed.ts:51-58` builds a regex that matches any quoted string ending in the changed file's base name, then greps every test file's text. It never follows imports. I copied the selection logic to `/tmp/t09/sel.ts` and ran it:

| Changed file                                                | Tests selected                                                                                                          | What is missed                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `server/src/writes.ts` (every server write goes through it) | `upload.test.ts` only                                                                                                   | write-cost, read-cost, sharing, push, activity, memo-tasks, images |
| `server/src/access.ts`                                      | read-cost, sharing, plus `shared/local-rows.test.ts` and `shared/screens.test.ts`, which only contain the word "access" | `upload.test.ts`                                                   |
| `shared/order.ts`                                           | `quick-add-buttons` and `search`, which only mention "order"                                                            | —                                                                  |

Every server test goes through `test-app.ts` → `api.ts` → everything, so the regex both over- and under-selects. CI still runs everything, but the documented purpose of the hook ("any unit test that imports the changed module", `testing.md`, Hooks) is not met.

Remedy: walk the import graph. For each test file, compute its transitive local imports once with `new Bun.Transpiler({ loader: 'ts' }).scanImports(source)`, resolving `./` and `../` paths. Select the tests whose closure contains a changed file. This removes the regex, the `skipImportNames` list, and the `name.length < 3` special case, and runs exactly the dependents. It is about the same line count, and behavior is a strict improvement. `.svelte` files can stay on the current basename rule, since no unit test imports a component.

### F4. The Ramble server path has no test at all [robustness] [CONFIRMED] [effort: M]

`server/src/ramble.ts` (491 lines) has no unit test of its own. The only test that imports it is `sharing-lock.test.ts`, which calls `ramble()` and `rambleRoute()` just to build an app and never exercises the socket path. `testApp` stubs sockets with a 501 (`test-app.ts:56`), and `ramble-budget.test.ts` covers only the global budget row.

None of these rules from `ramble.md` has a test:

- the 5-minute session cap and the 60-minute daily cap, counted in audio seconds;
- the frame that reaches a cap is cut at it and the session ends with a final commit;
- the `idle` end after a minute of silence;
- the midnight split, in the account's time zone;
- `daily-limit` on a session opened past the cap;
- 503 without `ELEVENLABS_API_KEY`;
- the human-only check.

The e2e specs cover only the cassette happy path. These caps are what "bound the cost of a leaked token", so a regression costs money.

The cassette upstream already exists (`RAMBLE_UPSTREAM=cassette`), and `testApp` takes a `ramble` config. A test can drive the session through the config `connect` with a fake upstream and a fake clock, with no real socket:

- push N frames, assert the `ended` reason and the seconds;
- set the clock to 23:59:30 in the account's zone, assert the seconds split across two `ramble_usage` rows.

### F5. A dictation test that would pass if `voiceCapture` returned `undefined` [simplification] [CONFIRMED] [effort: S]

`shared/dictation.test.ts:32-36` ("a native transcript still goes through the ramble grammar") calls the unrecorded `parseRamble('Buy milk', …)` and checks the title. It never touches `voiceCapture`, so it proves nothing about dictation. "Buy milk" is a trivial case of the corpus that `ramble.test.ts` already locks.

By `testing.md` ("repeats a case already in a parser table … does not stay") it should go. In the same file, the two `test.each(choices)` blocks (`:11`, `:14`) plus the two `native` tests (`:19`, `:23`) cover a 2×2×2 table in four tests. One `test.each` over `[choice, online, hasRecognizer, expected]` rows gives the same vectors with less reading.

### F6. e2e specs repeat cases the vectors already pin [simplification] [CONFIRMED] [effort: S]

`testing.md` forbids a test that "repeats a case already in a parser table or a vector".

- **`app-web/e2e/search.e2e.ts:27-35`** re-asserts ranking and matching rules case for case. `'sink home'`, `'sink garden'`, and `'dentist waiting'` are `shared/search.test.ts:98`, `:100`, and `:214`, and the `call` ordering repeats the label-ranking tests. The e2e part that only a browser can prove: `/` focuses the field, results group and highlight, Enter opens a label view and a task. Cut lines 27-35 and keep 1-26 and 37-46.
- **`recurring.e2e.ts`**: test 1 (31st → Feb 28 → Mar 31) is the `task.test.ts` "the 31st clamps to February" / "returns to the 31st" vectors. Test 2 (last Friday Oct 30 → Nov 27) is `task.test.ts` "the last Friday" (`2026-10-30` → `2026-11-27`) exactly. The UI wiring they add (repeat chip, toast) is already in test 4 ("completing a recurring task moves it and its reminder") and `phone.e2e.ts:73`.

Each e2e test costs a sign-up, a page load, and a sync, so these deletions also shorten the desktop run.

### F7. `layout.e2e.ts` sleeps, and seeds 47 tasks through the UI per width [robustness, efficiency] [CONFIRMED sleep / PLAUSIBLE cost] [effort: S]

`layout.e2e.ts:110` is `await page.waitForTimeout(350)` after setting `--keyboard-inset`. That is the one fixed sleep in the e2e suite, against the rule in `testing.md` ("A spec waits for its condition, never a sleep"). The rule's tool exists: `await app.settle()` waits for the running animations the inset change starts, which is what the 350 ms approximates.

`seed()` (`:120-127`) types 47 tasks one by one through quick add, each doing open sheet, fill, Enter, and wait hidden. It does this twice, once per width. The test needs `test.setTimeout(240_000)`.

The audit only needs long lists, not the quick-add path, which `quick-add.e2e.ts` covers. Seeding through one `/api/upload` batch would cut most of this test's time. `App.pushFromOtherDevice` already shows how: build the rows, post them, then wait on `pending()` and the rows' arrival. Fold it into a `seedTasks(titles)` helper in `fixtures.ts`.

### F8. The full `Task` literal is copied into 10 shared test files [simplification] [CONFIRMED] [effort: S]

`shared/testing.ts:5` exports `task(id, fields)` with every `Task` field. A local copy of the same 20-line literal still lives in:

- `markdown.test.ts:10`
- `name-search.test.ts:29`
- `notifications.test.ts:13`
- `row-actions.test.ts:9`
- `screens.test.ts:25`
- `search.test.ts:21`
- `store.test.ts:38`
- `subtasks.test.ts:16`
- `triggers.test.ts:46`
- `views.test.ts:23`

`zoned-time.test.ts:44` inlines the same object. That is about 220 lines, and every new `Task` column means 11 edits.

The variants differ only in `createdAt` (`++created` counters, or a positional argument in `store`) and in `id` and `title` defaults. Each becomes a one-liner over the shared factory:

```ts
let created = 0;
const task = (id: string, fields: Partial<Task> = {}) => base(id, { createdAt: ++created, ...fields });
```

Test inputs stay identical, so the assertions and the recorded vectors do not change. Rerun `bun run vectors` to confirm an empty diff. In the same spirit, `screens.test.ts:68` restates `NO_DEFAULTS`, which `ramble-fill.test.ts` imports from `screens.ts`.

### F9. The cost pins are useful, but write-cost names statements too coarsely to read a failure [simplification] [CONFIRMED] [effort: S]

`write-cost.test.ts` and `read-cost.test.ts` deliberately pin statement counts, and that is worth keeping. They are the only guard against an N+1 or a whole-space load returning, and `server/AGENTS.md` names them.

The two files classify statements differently:

- `read-cost`'s `named()` (`:72-79`) yields `select tasks`, `insert log`, `select tasks + log + log`.
- `write-cost`'s `statementsOf` (`:29-36`) keeps only the verb.

So the "move in a space with a human grantee" pin (`write-cost.test.ts:101-113`) is six bare `'select'`s in a row. When it fails you cannot tell which read crept in, and a reordering of two different selects still passes.

Move `named` into `test-app.ts` as `statementNames(app)` and use it in both files plus `actor.test.ts`. The write-cost lists become self-describing, and the comment on line 100 that spells out the six selects is no longer needed. Behavior pinned: the same or stricter.

The pins are brittle by design: any legitimate refactor that reorders reads changes a literal. That is acceptable because the literal diff is the review artifact, but only if the names are readable.

### F10. The server suite migrates a fresh PGlite 13 times; cloning one migrated database would roughly halve it [efficiency] [PLAUSIBLE] [effort: S]

Each `testApp()` runs `new PGlite()` and `migrate()`. Measured in `/tmp/t09/time.test.ts`:

| Step                                                                             | Time                     |
| -------------------------------------------------------------------------------- | ------------------------ |
| `new PGlite()` + `migrate()`                                                     | 600 ms cold, 441 ms warm |
| `clone()` of the migrated instance (PGlite 0.5.10, all 20 public tables present) | 106 ms                   |

13 files call `testApp` 14 times. Each server file takes about 1.0 to 1.5 s alone against about 0.17 s for a file that does not use PGlite. The whole suite is 8.8 s serial.

A module-level `const template = migrated()` promise in `test-app.ts`, with each `testApp()` doing `await (await template).clone()`, keeps "each `testApp()` is a fresh database". It should save about 4 to 5 s per `bun test`, which runs on every pre-push via F3. `testing.md`'s "about 1.5 s to migrate" is stale on this machine (0.45 to 0.6 s).

### F11. `images.e2e.ts` re-implements `unique` without the guard, and three specs re-implement the device harness [robustness, simplification] [CONFIRMED] [effort: S]

`images.e2e.ts:6` defines its own `unique = name => \`${name} ${uuid.slice(0, 8)}\``. That drops the leading `x`that`fixtures.ts:30`adds precisely because "a bare hex id … is a due date". Sampling 200k suffixes against`parseQuickAdd`, 0.07% of runs give one of the three image titles a parsed token (e.g. `Fix the fridge 1534173d`→ title`Fix the fridge`). `app.row(title)`then never resolves. The fix is to import`unique` from fixtures.

The same file's `device()` (`:110-118`) duplicates `sync.e2e.ts:26-34` but without the 30 s first-load wait sync documents for WebKit, and images runs in the WebKit `mobile` project too. `sync`, `sharing` (`person()`), and `images` each also carry an `afterEach` that closes every `browser.contexts()`.

One `devices` fixture in `fixtures.ts` would replace three `device` and `person` helpers and three `afterEach` blocks, with Playwright's fixture teardown closing contexts: `devices.open({ timezoneId?, account?: 'same' | 'new', name? })` returning `{ app, page, context }`. `projects.e2e.ts:147-156` would use it too instead of its raw `browser.newContext`, which also skips `serviceWorkers: 'block'`.

## Smaller notes

**Serial specs.** `sync.e2e.ts:24` and `sharing.e2e.ts:6` set `mode: 'serial'`, and nothing documents why. Every test already signs up its own accounts. Serial means the 19 sync tests run on one worker as the suite's long pole, and the first failure skips the rest, hiding later regressions in that CI run. If the reason is PowerSync load, `test.describe.configure({ mode: 'default' })` plus `--workers` already caps it. If there is a real ordering dependency, it should be written down. Product question for Stefan.

**`ramble-budget.test.ts`.** `budgetRules(name, make)` is a harness built for several implementations, and only `postgres` remains (it outlived the Turso ledger). Its day key `2026-10-${name.length}` yields the unpadded `2026-10-8`. Inline the two tests and use a real date key.

**`ramble.test.ts:269-277`.** "a subtask segment lies inside its parent segment" asserts inside `for (const subtask of party.subtasks)`. If the parser stopped producing subtasks, the loop body would never run and the test would still pass. Assert the literal segments instead (I checked them: `[0,49]` with subtasks `[29,40]` and `[45,49]`, then `[50,59]`).

**`todoist.test.ts:52-59`.** The test computes its expected value with `toDateKey` and `toTimeOfDay` on the same `Date`, so it mirrors the implementation. It is saved by the vector file, which records a literal under `TZ=America/New_York`. Pinning the expected `{ date: '2027-05-20', time: '17:30' }` with a note that `bun test` runs in the process zone would be equivalent, but only under a fixed TZ. Acceptable as is.

**`fixtures.ts`, `App.openQuickAdd`.** It clicks `body` at a hard-coded `(1200, 700)` to blur, which assumes the 1280×800 desktop viewport. `projects.e2e.ts`'s 1280×480 "short window" would click off-screen if it ever opened quick add. Using `page.keyboard.press('Escape')` or blurring `document.activeElement` avoids the coupling.

**`fixtures.ts:74-86`.** Two JSDoc blocks are stacked, so `watchPageErrors`' explanation attaches to `NAVIGATION_ABORT`. This is reader load, not behavior.

**`optimistic.e2e.ts`.** It uses a 1 s `INSTANT` assertion against a 2 s server delay. That is intentional, but it is the one e2e assertion sensitive to machine load (the doc cites load average above 500).

**`inputs.e2e.ts`.** It reads `clientHeight` right after `fill()`. That is fine today because the grow happens in the input handler, but `expect.poll` would make it robust to a later move into an effect or a `requestAnimationFrame`.

**`record.ts`.** `test` from the wrapper has no `.skip`, `.only`, or `.todo`, so a vector test cannot be skipped without dropping to `bun:test`. `plain()` silently turns `NaN` and `Infinity` into `null`. Neither has bitten yet.

## Test coverage observations

**Behavior first, mostly.** Shared tests and the server route tests assert literal outputs and go through public entry points. `test-app.ts` honors "nothing here reaches into the store" for requests. Direct DB reads are used only to observe effects that no route exposes: `access` rows, `log` rows, `push` plans, image `orphanedAt`. That is reasonable, but it couples `sharing.test.ts` to the `access` table shape. Several of those checks could be phrased through `GET /api/view?space=` as a guest, as some already are.

**Biggest gaps against the decision docs:**

1. The Ramble server's caps, idle end, midnight split, `daily-limit`, and 503 (F4).
2. The advisory-lock ordering for shares and guest writes, which in practice runs nowhere (F1).
3. The memo-tasks rule "a task Stefan deleted in the app never comes back on resend" (F2).
4. `server/src/crons.ts` has no test of the scheduled entry itself; `sweepImages` and `deliverDue` are tested directly.
5. Better Auth session revocation across devices is tested only for the cache drop on sign-out (`actor.test.ts`), not for "a token revoked elsewhere works for at most a minute".

**Run times.** `bun test shared`: 1509 tests in 0.235 s wall. `bun test server`: 125 tests (2 skipped) in 8.78 s wall. No failures. The server time is about 70% PGlite migrations plus Better Auth sign-ups (F10). I did not run the e2e suite. By inspection its slowest specs are `layout` (two 47-task UI seeds, 240 s budget, F7) and the serial `sync` file (F11 and the serial note).
