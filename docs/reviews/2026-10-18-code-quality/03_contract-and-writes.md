# API contract, schema, and server write/read core review

Scope: shared/api/contract.ts (583), shared/db/schema.ts (339), shared/db/json.ts (49), server/src/writes.ts (445), commands.ts (500), upload.ts (148), access.ts (148), space.ts (149), memo-tasks.ts (168), actor.ts (112), errors.ts (10), app.ts (21), api.ts (38), people.ts (64), sharing.ts (233), router.ts (361). I read all of them in full. I also read shared/scope.ts (168) and shared/rows.ts (107) for the guest admission rules and coalescing, parts of shared/store.ts and shared/comments.ts for the duplication questions, test-app.ts, upload/sharing/write-cost/read-cost tests, and docs/decisions/sharing.md and comments.md.
Commit: ad9437e
Method: I traced every route in router.ts to its authorization check. I traced the upload path (parseWrite, applyWrites, land/statement, asGuest, guestRefusal, finish) and the agent path (run, authorityOf, applyAs). I wrote five scratch bun tests under /tmp/thermo03/ against the real test-app on PGlite (hole, partial, comment, undo, batch .test.ts) to reproduce each bug below. I also ran the slice's existing suites: upload, sharing, sharing-lock, write-cost, read-cost, activity, memo-tasks (67 pass, 2 skip). I did not run tsc or svelte-check.

## Verdict

The write core is compact and well documented, and the owner path is sound: the ownership check and the authorship stamps sit inside each single-row statement, retries converge through op ids, and the cost tests pin the statement counts. The weak spot is guest admission. `guestRefusal` assumes every guest `put` creates a row, and `applyWrites` never tells it otherwise. So a guest with an edit share on any project can overwrite a private task of the owner's whose id it knows, and the id is easy to learn. The same assumption lets a guest edit its own comment on a task it can now only view. Admission also reads the guest's `access` rows only once per batch, so ordinary offline batches lose writes. And an agent command that `guestRefusal` refuses still commits the writes it did allow before answering 403. All four reproduce in scratch tests, and each fix is small and local to writes.ts and scope.ts.

## Findings (most important first)

### F1. A guest `put` overwrites rows it cannot see or may not edit [bug] [CONFIRMED] [effort: S]

Where: server/src/writes.ts:274-276 sends every non-own `put` to `foreign` with no `stored` lookup. shared/scope.ts:148-153 handles the `role === undefined` case as "a new task" (`mayAdd`). Then the upsert in writes.ts:129-150 overwrites any conflicting row whose `user_id` matches the space (`setWhere: eq(tasks.userId, sql\`excluded.user_id\`)`).

Concrete case: the owner shares project P with the guest to edit, and has a private Inbox task H. The guest uploads `put tasks H { user_id: owner, project_id: P, title: 'pwned', ... }`. `roleOf(rows,'task',H)` is undefined and `mayAdd` passes through P, so the upsert rewrites every column of H and moves it into P. The access recompute then also shows H to the guest. The scratch test /tmp/thermo03/hole.test.ts prints `rejected [] row pwned <P>`. The guest learns hidden ids without trying: `scopeOf` includes the descendants of a reached task but not its ancestors. A task reached by a label share, or a subtask shared on its own, therefore syncs a `parent_id` naming a task the guest cannot see. Ids from a share that was later revoked work too.

The same root cause hits comments. A guest's own comment on task A, after A's share is downgraded to view, can still be rewritten. A `patch` is correctly refused, but a `put` naming an editable task B passes `guestRefusal` with `stored === undefined`. The upsert then updates the body, and the comment stays on A because the statement never sets `task_id` (/tmp/thermo03/comment.test.ts: `patch` rejected, `put []`, body `via put`). This breaks comments.md: "edit or delete only their own comment on such a task".

Remedy: look up the stored row for foreign puts as well. `storedRows` already batches one select per kind, so include `foreign.filter(w => w.op === 'put')` in that call, and pass the result to `guestRefusal` for both kinds. In `guestRefusal`, a task the server holds but the guest has no `edit` row for is refused: replace the `role === undefined` branch with `stored ? role === 'edit' : mayAdd`. A comment then goes through the existing stored-comment branch. Cost: one extra select per kind, only in batches with guest puts. The pinned guest case in write-cost.test.ts is a patch, so it does not change. A cheaper SQL-only variant for tasks: when `role === undefined`, run the guest's insert as `onConflictDoNothing`, so `missedPut` reports it. This needs no new statement, but it does not cover the comment case. Behavior for legitimate creates and edits is unchanged. Add both cases to sharing.test.ts.

### F2. An agent command that `guestRefusal` refuses still commits the writes it allowed [bug] [CONFIRMED] [effort: S]

Where: server/src/writes.ts:395-403 (`applyAs`, guest branch) lands each admitted write and skips the refused ones. commands.ts:181-182 then throws `FORBIDDEN` with the first reason. sharing.md says the command API "refuses with FORBIDDEN when guestRefusal refuses any of them". A caller reads a 403 as "nothing happened". Here, part of the change has happened.

Concrete case: the owner has parent P with child C, shares P with a human guest to view and C to edit. The guest calls `DELETE /api/tasks?id=P&space=<owner>`. `visibleTask` passes because P is visible, though not editable. `deleteTask` cascades to C, and `guestRefusal` refuses `delete P` and admits `delete C`. The response is `403 Not editable in this share`, yet C is gone (/tmp/thermo03/partial.test.ts: `status 403`, `left [ "Parent" ]`). Commands like `deleteProject` or `deleteSection` produce many writes and can split the same way when shares overlap.

Remedy: inside the `asGuest` callback, compute every reason first. If any is non-null, return them without landing anything. Since this is already one transaction, that makes the command all-or-nothing. Upload keeps per-write rejection, because only `applyAs` takes this branch. A cleaner version also checks `scope.editable` in `visibleTask` for mutating commands, so the request fails before the rule runs.

### F3. A guest's batch is admitted against the `access` rows from before the batch, so its dependent writes are refused [bug] [CONFIRMED] [effort: S]

Where: server/src/access.ts:97-103 reads the guest's rows once per transaction. writes.ts:311-315 then admits each write against that fixed list, in `inLockOrder`. That order sorts `comment:` before `task:` and ignores parent-before-child order.

Concrete case: a guest with edit on task P uploads, in one batch, a new subtask S under P, a sub-subtask SS under S, and a comment on S. This is ordinary after a few seconds offline, or within one upload debounce. The response rejects the comment and SS with `Not editable in this share`, because no `access` row for S exists yet (/tmp/thermo03/batch.test.ts). The device then reverts both at its next checkpoint, so the guest silently loses them, with only the generic "Couldn't save changes to 2 items" toast.

Remedy: split admission from landing. Run `guestRefusal` over the coalesced writes in batch order. `rowWrites` and PowerSync both put parents first, and `KINDS` puts tasks before comments. After each admitted task `put`, push `{ kind: 'task', entityId: id, role: 'edit' }` onto a local copy of the rows. That is exactly what the recompute will store: a task added under an edit parent, project, or label falls inside an edit grant. Then land the admitted writes in `inLockOrder` as today. The behavior for single writes is unchanged.

### F4. A guest cannot undo deleting an imported task [bug] [CONFIRMED server side, PLAUSIBLE client side] [effort: S]

Where: shared/scope.ts:120 refuses any guest task write with a non-null `sourceKey`. After a guest deletes a Todoist-imported task in a project shared to edit, the client's undo re-puts the full row, `source_key` included (`fieldsOf` carries it, and PowerSync syncs the column). /tmp/thermo03/undo.test.ts shows the delete accepted and the undo put rejected with `Not editable in this share`, and the row stays gone. The rule exists so that guests cannot mint import keys. A related effect: a guest's full re-put without the key (PUT_DEFAULTS fills `null`) wipes the owner's `sourceKey`, so a later re-import duplicates the task (same test: `key after null`).

Remedy: drop `sourceKey` from a guest's task write instead of refusing it. In the guest branch of `land`, delete `values.sourceKey` before the statement, so the excluded-column list keeps the stored value on conflict and inserts null otherwise. The undo then restores the task, without its import key, and no guest ever writes a key. Product question: restore the key from the log on a guest undo, or accept losing it. Either is better than losing the task.

### F5. A failure partway through a batch skips the log row and the derived work for writes that already committed [robustness] [PLAUSIBLE] [effort: S]

Where: writes.ts:272-285 and 390-394 run the batch's statements with `Promise.all`. The first non-refusal error (a dropped connection, a Hyperdrive timeout) rejects at once, so `finish` (writes.ts:425-438) never runs, while the other statements may still commit. For an upload this converges, because PowerSync retries the batch and `spacesOfGone` counts the already-gone deletes as landed. For the agent API it does not: op ids are `newId()` (commands.ts:178), and the retried command re-reads a state that has already changed. For example, `removeProject` retried answers NOT_FOUND. The committed deletes then have no `log` rows (activity shows nothing), no access recompute (guests keep stale rows), and, most visibly, no `replan`, so a deleted task's push notification still fires.

Remedy: `const settled = await Promise.allSettled(...)`, then run `finish(db, ctx, landed)` on whatever landed, then rethrow the first rejection. The owner/manager branch of `applyAs` needs the same three lines. Statement counts are unchanged.

### F6. A large batch costs one statement per row where one statement per kind would do [efficiency] [PLAUSIBLE] [effort: M]

Where: writes.ts:272-285. The web and iOS upload up to 1000 CRUD entries per batch (app-web/src/lib/powersync.svelte.ts:30, SyncConnector.swift:36). A Todoist import or a long offline stretch therefore becomes up to 1000 single-row upserts. postgres.js pushes them through a pool of 5 connections (server/src/db/postgres.ts:19), over Hyperdrive in production. This is a documented design ("one single-row statement"), and it buys per-write error isolation, but nothing requires that isolation to be per statement. A multi-row `INSERT ... VALUES (...), (...) ON CONFLICT (id) DO UPDATE ... WHERE user_id = excluded.user_id RETURNING id` per kind tells exactly which rows landed: the missing ids are today's `missed` set. Only when the statement raises a 22xxx/23xxx error do you fall back to the per-row path to find the culprit. Patches with differing column sets stay per row, but imports and offline creation are puts. At 500 tasks this turns about 500 statements into about 3 (tasks, projects, labels) plus the log insert. Pin the result in write-cost.test.ts with a 50-put batch. Behavior is identical, including which writes end up in `rejected`.

### F7. The contract's worker/space split is vestigial and is merged back together by hand [simplification] [CONFIRMED] [effort: S]

Where: shared/api/contract.ts:117, 512, 576-581. `workerContract` and `spaceContract` are referenced only inside this file (grep: scripts/generate/openapi.ts imports `agentContract` and `contract` only). The final `contract` re-merges their `push` and `shares` halves by hand (`push: { ...workerContract.push, ...spaceContract.push }`). Two consequences: `shares.create` lives apart from `shares.list` and `shares.delete`, and adding a route to either half means remembering the merge. The split came in with the Postgres move (git -S finds only ad9437e) and corresponds to no current runtime boundary: one Worker serves everything. Remedy: one `export const contract = { ...agentContract, status, auth, push: {...all five}, people, me, ai, shared, shares: {...all three}, debug, docs, sync, tokens, memoTasks }`, and delete `workerContract`, `spaceContract`, and the two merge lines (about -10 lines). The generated OpenAPI paths and the router keys stay byte-identical.

### F8. Name uniqueness is split between the store and the agent commands [simplification, partly a product question] [CONFIRMED] [effort: S]

Where: shared/store.ts enforces case-insensitive uniqueness for sections (`addSection` returns the existing one, `renameSection` via `takenIn`) and for labels on rename and `savePlace`. It does not for `addProject`, `renameProject`, or `addLabel`. server/src/commands.ts:378-379 (`sameName`) re-implements the rule for projects and label creates, while `editSection` and `editLabel` detect a clash by `next === data`. That makes three styles for one rule. Meanwhile the web (app-web/src/lib/store.svelte.ts:504-511, 541) can create two projects named "Home", which breaks the stated reason for the rule (`#Home` must resolve to one). Remedy: give `addProject` and `addLabel` the `addSection` shape (return the existing entity), and give `renameProject` the `renameSection` shape (no-op on a clash). Then `createProject`, `createLabel`, and `editProject` use the returned entity and `next === data` like sections do, and `sameName` disappears. On the agent side behavior is identical. On the web and iOS it is a product change: duplicate project and label names stop being creatable. Flag it to Stefan rather than doing it silently.

### F9. The agent task commands read the task twice after writing [efficiency] [CONFIRMED] [effort: S]

Where: commands.ts:193-200. `taskAfter` selects the row, then `withClients` selects `tasks` again with the two lateral log reads. read-cost.test.ts pins this as `'select tasks', 'select tasks + log + log'`. Remedy: have `withClients` select the full `taskTable` row alongside the laterals (`{ task: taskTable, created: ..., edited: ... }`). `taskAfter` becomes that one query, and `view` maps the rows by id the same way. Each agent create, edit, complete, and reopen saves a round trip, and the pin drops by one. The response is unchanged.

## Smaller notes

server/src/space.ts:101-107 has two stacked doc comments on `Sight`. The first is stale: it says another AI account's "scope is worked out from the tree", but AI accounts get `access` rows now. `sightOf` is `async`, takes a `db` it never uses, and does no I/O. Make it a sync function of `(actor, access)` and delete the stale block. Callers lose an `await`, and the statement counts are unchanged.

`api_tokens.lastUsedAt` is never written: server/src/actor.ts `tokenActor` only reads, and sharing.ts:212 inserts null. No client renders it outside generated types. Either stamp it (a fire-and-forget update in `tokenActor`, at most once a minute) or drop the column and the field from `apiTokenSchema`.

memo-tasks.ts:142 and :167 discard `applyAs`'s `rejected`. `putMemoTasks` then returns the "added" tasks even if a write was refused (for example, a 22xxx from an odd `notes`). Throw on a non-empty `rejected`, as `run` does.

`sharedView` (sharing.ts:162-169) loads the whole tree, every column of every task, on an unauthenticated route, then filters it. It also returns the full `taskSchema`: `location` coordinates, `event`, `createdBy`/`completedBy` user ids, and `sourceKey`, plus label `place` coordinates, to anyone holding the link. A cheaper and narrower path is `loadLinks` for `scopeOf`, followed by one select per kind restricted to the scoped ids. Whether link viewers should see locations is a product question for Stefan.

Upload envelope validation is written twice. `uploadWriteSchema` (contract.ts:88) exists only to generate the Swift type, while `parseWrite` (upload.ts:102-116) hand-checks the same shape with `isRecord` and `typeof`. `uploadWriteSchema.safeParse(raw)` would replace those lines. Map its issues to the reason strings that upload.test.ts pins (`Malformed write`, `Unknown table nope`).

The comment author rule is enforced in four places: `editComment`/`deleteComment` in shared/comments.ts, `ownComment` in commands.ts, `guestRefusal` in scope.ts, and the `author_id = actor` `WHERE` in writes.ts. Only the SQL is authoritative. The others exist for error messages, and they word the same refusal two ways (`Only the author can edit a comment` vs `Only the author can change it`). `TaskFields`/`CommentFields` and the author messages are also duplicated between writes.ts and scope.ts. Export them once from scope.ts.

`spacesOfGone` (writes.ts:330-365) attributes a delete of a gone row to the last space the actor wrote it in, even after the actor's share was revoked. A revoked guest can therefore append `delete` log rows (and trigger a recompute and a replan) in a space it no longer reaches, for ids it once wrote. This is harmless to the data and cheap, but `finish` could skip such a space when the actor has no share there.

A guest batch pays SAVEPOINT plus statement plus RELEASE per write, all sequential inside the transaction. That is 300 round trips for 100 writes. Since `parseWrite` already schema-checks values, the database refusing a write is rare. You could try the batch without savepoints and retry with them only when a 22xxx/23xxx aborts the transaction.

## Test coverage observations

- No test sends a guest `put` with the id of an existing row the guest cannot edit or see (F1), or rewrites a comment by `put` after a downgrade.
- No test covers an agent command that `guestRefusal` partly refuses (F2). sharing.test.ts covers only all-allowed and all-refused cases.
- No test sends a guest batch whose writes depend on each other (F3). Every guest test in sharing.test.ts uploads one new row per call.
- Nothing covers a guest's undo or restore of a task with a `sourceKey` (F4).
- No test injects a database failure mid-batch to check that `finish` still runs (F5).
- write-cost.test.ts pins the statements of single-write uploads only. A many-row batch is unpinned, so F6's gain, or a regression, would go unseen.
- The cost tests count statements by their first word and table, which is behavior-adjacent but fine. The authorization tests call routes as clients do, which is the right level.
