# Sync

Web and iOS share one set of tasks, projects, and labels through the Worker. The server holds the truth. Each client keeps a full local copy, works fully offline, and catches up when it syncs. Conflicts resolve on their own, so there is never a conflict screen.

## What syncs

- **Synced:** tasks, projects, labels, and one `settings` record with the id `settings`, which exists without a create and cannot be deleted. The only setting today is `timeZone` (IANA name), which the server needs to compute notification times. A device writes it only when its own zone changes from the last one it saw, such as after travel, never because the synced value differs. So two devices in different zones do not overwrite each other, and the device that moved last wins.
- **Device-local:** the theme (see [Theming](theming.md)), `remindersCheckedAt` (each open app toasts its own reminders), the push subscription, the sync section, and the device token. The token never sits in the snapshot document: the web keeps it under its own `localStorage` key, `procrastimate-device`, and iOS keeps it in the Keychain.
- **Entities keep their shape.** `Task`, `Project`, and `Label` stay as they are in `shared/task.ts`. Ids are client-made UUIDs, so creating offline never collides. The one model change is ordering (see Conflicts).

## Server

- **One Durable Object per account, `Account`, on SQLite.** There is one account. A Durable Object runs one request at a time, so applying a push and assigning sequence numbers needs no locking. It also owns the account's alarm for push and, later, the WebSocket nudges. D1 would add a second binding, a network hop, and no alarms or sockets. The SQLite-backed object is on the free plan, and Stefan's write volume (one row per changed entity, plus one log row) is far below its daily limits.
- **Tables.**
  - `entities(kind, id, data, clocks)`: the current value of every task, project, label, and the settings record, with one hybrid logical clock per field. A deleted entity stays as a tombstone (`deleted: true`), so a late edit cannot bring it back by accident.
  - `log(seq, op_id, kind, id, fields)`: append-only, with `seq` as the monotonic server sequence. Each row holds only the fields that won, so clients can apply the log in order without clocks. Every applied op gets a row, with empty `fields` when it won nothing, so the log alone answers whether an op was applied. When an entity turns live (a create or an undelete), its row carries all its fields, so a client that never had it can build it. A client skips a partial row for an entity it does not have.
  - `devices(id, name, token_hash, created_at, last_seen_at, revoked_at)` and `pairing(code_hash, expires_at, attempts)` for auth.
- **No compaction yet.** The log grows by one row per change. A client whose cursor is `0` gets a full snapshot instead of the log. If the log ever needs trimming, clients behind the trimmed point get the snapshot too.
- **The merge is shared code.** `shared/sync/` holds the pure rules: `applyPush` (`applyOps`, then `applyFixups`, which runs `fixups` and writes its repairs as server ops) and `serverSnapshot` on the server, and the HLC, `diff`, `commit`, `startSync`, and `applyResponse` (`applyChanges` plus outbox replay) on clients. The Durable Object only reads rows, calls them, and writes rows. The Bun dev server runs the same handler on an in-memory store, so local dev and Playwright can sync without `wrangler`.

## Protocol

- **Ops.** One op per changed entity per command: `{ opId, hlc, kind, id, fields }`. `fields` carries the new values of the fields that changed, and `deleted: true` or `false` for delete and undelete. Clients never send intent like "complete" or "advance", only resulting values.
- **Ops come from diffs.** The store's commands stay as they are. Each command's commit compares the snapshot before and after, entity by entity and field by field, and appends one op per changed entity to the outbox. A missing entity becomes a tombstone, and one that comes back (undo of delete) is sent with `deleted: false` and all its fields. Undo of a completion writes only the fields it restores, as it does now.
- **Hybrid logical clock.** `<wall ms>:<counter>:<deviceId>`, compared as a tuple. A client never issues a clock lower than the highest one it has seen from the server. The server replaces a clock whose wall time is more than a minute ahead of its own with its own next clock, keeping the device id as the tie-break, so a device with a wrong clock cannot win every conflict. A wall time or counter past `Number.MAX_SAFE_INTEGER` fails validation.
- **One round trip.** `POST /api/sync { cursor, ops }` applies the ops in order, skipping any `opId` already in the log, so a retry never applies twice. It then runs `fixups` and returns `{ acked: opId[], changes: log rows after cursor, cursor, hlc }`. With `cursor: 0` it returns `{ acked, snapshot, cursor, hlc }` instead, since the first sync uploads ops too.
- **The handler.** `server/src/account/sync.ts` authenticates the device, then in one storage transaction loads every entity, runs `applyPush` with the log answering whether an op was applied, writes the entities that changed, and appends every returned log entry, empty ones included. The server's clock is not stored: it only has to stay ahead of every field clock, so each request rebuilds it from them, and `tick` keeps it ahead of the wall time.
- **Paging.** A response carries at most 1,000 changes, and its `cursor` is the last one it carries. A client that gets a full page syncs again right away. A cursor past the end of the log, as after the in-memory dev server restarts, gets the snapshot like cursor `0`, so the client starts over instead of waiting for rows that will never come.
- **Local state.** The client stores its snapshot plus a `sync` section with its device id, cursor, and outbox: in the `procrastimate` `localStorage` document on the web, and in the same JSON document on iOS. After a response, the client drops the acked ops, applies `changes` in order, then reapplies what is still in the outbox, so edits made while the request was in flight stay visible. The server reports what actually won on the next sync.
- **When to sync.** On launch, on focus or foreground, when the network returns, one second after a commit, and every minute while visible. On iOS also from the `BGAppRefreshTask` that refills notifications. A failed sync keeps the outbox and retries on the next trigger. A WebSocket nudge from the Durable Object (hibernation API, so idle sockets cost nothing) comes later and only triggers a sync.
- **Deterministic order everywhere.** Top-level task lists use the store's array order today, and sync must not depend on arrival order. Clients keep tasks sorted by `createdAt` then `id`, which matches the current insertion order.

## Conflicts

Every field is last-writer-wins by HLC. Different fields from different devices merge, so renaming on one device while completing on the other keeps both. After applying a push, the server runs `fixups`, which writes any repair as server ops into the log like any other change. Clients therefore converge on exactly what the server holds.

- **Delete vs edit: delete wins.** `deleted` is a field of its own. Editing other fields never clears it, so an edit made offline to a task deleted elsewhere is dropped. While an entity is deleted, only `deleted` can change, so dropped edits are not stored either. Undo of delete writes `deleted: false` with a newer clock and restores the task.
- **Complete vs edit.** `completedAt`, `due`, and `reminders` are separate fields from `title`, `notes`, and the rest, so both changes survive.
- **Recurring task completed on two devices.** Completing sends the resulting `due` and `reminders`, not "advance by one". Two devices that complete the same occurrence send the same next date, so the task advances once. If one device completed it twice offline, the later write wins, so it never advances more than one device did.
- **Reorder.** `order` becomes a fractional position. Moving a subtask writes only that task's `order`: the midpoint of its new neighbors, or one more or less than the last or first. Siblings sort by `order`, then `createdAt`, then `id`, so a tie from two concurrent moves still settles the same way everywhere. When a gap gets below `1e-9`, the move renumbers its siblings instead, which is rare.
- **Subtask whose parent was deleted.** A subtask added offline under a task deleted elsewhere was never seen by the deleter, so `fixups` keeps it and makes it top level, the same rule as `detachOrphans`. Subtasks the deleter did know about are tombstoned by its own diff.
- **Open subtask under a completed parent.** A subtask added or reopened offline under a parent completed elsewhere reopens the parent and its completed ancestors, like `addTask` and `reopenTask` do locally.
- **Subtask project.** A subtask always takes its root's project. If a move and a parent change race, `fixups` rewrites the subtask's `projectId` to the root's.
- **Project deleted while tasks moved into it.** Deleting a project tombstones it and every task its device saw in it. A task moved into it or added to it on another device lands in Inbox (`projectId: null`). A task that device moved out of it is still deleted, because the deleter saw it there; that loss is accepted.
- **Label deleted while being added or renamed.** Delete wins over the rename. `fixups` removes a deleted label's id from every task's `labelIds`.
- **Arrays are single fields.** `labelIds` and `reminders` are last-writer-wins as a whole. Two devices adding different labels to the same task offline keep one device's set. Per-item merging is not worth the complexity for one user.
- **Duplicate names.** Two live labels whose names match ignoring case merge into the one with the lowest `createdAt`, then `id`. Tasks get the survivor's id and the other is tombstoned. Projects merge the same way, moving their tasks. This also covers a rename on one device that collides with a create on another.
- **Todoist imported on two devices.** Live tasks or projects with the same `sourceKey` merge into the lowest `createdAt`, then `id`. Subtasks of the dropped copy get the survivor as their parent. The import still runs locally, and its tasks sync as ordinary creates.

## First sync and migration

- **Turning sync on uploads everything.** A device that is not paired keeps no outbox. When it pairs, it sends its whole local snapshot as ops with `cursor: 0` in one request, then takes the returned snapshot as its state. Ids are UUIDs, so two devices that each have local data simply add up. `fixups` then merges what they share: Todoist imports by source key, and labels and projects by name. Two hand-typed tasks with the same title on two devices stay two tasks, since nothing says they are one.
- **No backwards compatibility.** The stored document gains a `sync` section. A device without it starts unpaired, which is today's behavior.

## Auth

- **Device tokens bootstrapped by a pairing code.** The default, picked so Stefan can change it later:
  - The first device sends the `SYNC_SETUP_CODE` Worker secret, which Stefan sets once with `wrangler secret put`, and receives a device token.
  - A paired device's Settings shows `Pair a device`: an eight-character code valid for ten minutes and five attempts. The new device enters it and receives its own token.
  - A token is 32 random bytes, sent as `Authorization: Bearer`, stored only as a SHA-256 hash. Settings lists devices with their last sync and `Remove`, which revokes the token at once.
  - The web keeps the token in `localStorage` under `procrastimate-device`, since the app loads no third-party scripts. iOS keeps it in the Keychain.
- **Isolated.** `server/src/auth.ts` exposes `authenticate(request) → deviceId | null` and the pairing routes. Nothing else reads tokens, so passkeys (WebAuthn) can replace the setup code later by changing that file and the pairing screen.
- **Sync is opt in.** An unpaired client works as today, except Web Push once the server computes the schedule, so the existing unit and end-to-end tests need no server.

## Notifications

- **The server computes the Web Push schedule.** Once sync is on, the `Account` object knows every task, so after each push it recomputes all pending notifications from `notificationTimes` in the account's `timeZone` and arms one alarm for the earliest. It sends to every subscribed web device. A change made on iOS or on a closed laptop then reaches the phone's Web Push right away, without each device uploading its own schedule. `PushSchedule` and `PUT /api/push/schedule` are removed, and subscriptions register under the device token. Web Push therefore needs a paired device: the Notifications panel offers `Turn on sync` first when the device is unpaired. Keeping the old per-device path for unpaired browsers would mean two schedulers for one user.
- **iOS keeps local notifications.** They are recomputed from the synced state after every pull, so iOS needs no APNs.
- **Time zones.** The server cannot use the process zone, so `shared/` gains a helper that turns a `DateKey` and `TimeOfDay` into epoch milliseconds in a named zone with `Intl`. The client's `notificationTimes` keeps the device zone.

## Testing

- **Unit tests** cover each rule in `shared/sync/` with the cases above.
- **Convergence fuzz.** `shared/sync/converge.test.ts` simulates two or three clients and the server with a seeded random generator. Clients apply random commands (add, edit, complete, reopen, move, delete, undo, rename, label, import), go offline, and sync in random interleavings. After a final sync of everyone, every replica must equal the server, and the invariants must hold: no orphans, no open task under a completed one, subtasks in their root's project, unique label and project names, and unique source keys. CI runs a fixed set of seeds. `SYNC_SEEDS=<n>` runs more locally, and a failing seed prints a replayable log.
- **Swift vectors.** iOS only runs the client half: the HLC, `diff`, and `applyChanges` with outbox replay. Their TS tests record `shared/vectors/sync.json` through `recorded('sync', …)`, the same as the other modules (see [iOS app](ios.md)), so the Swift port must produce identical ops and states. The merge and `fixups` run only on the server, so Swift never ports them.
- **End to end.** One Playwright test opens two browser contexts against the dev server's in-memory account and covers propagate, offline, reconnect, and conflict from the [feature map](../../.cursor/skills/verify-procrastimate/features/offline-sync.md).

## Build order

The slices, with what each owns and what it waits for, are in [Sync build slices](../sync-slices.md).
