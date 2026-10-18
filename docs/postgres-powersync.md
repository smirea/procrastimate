# Postgres and PowerSync

ProcrastiMate drops Turso and its own sync engine. Postgres becomes the one server database, PowerSync syncs it into a SQLite database on every device, and Drizzle on the server and the web and GRDB on iOS read and write it. This file holds the requirements the move must meet, the target design, the questions the proof of concept answers first, and the order of the work. Once the move lands, the decisions it makes live in the area files under [decisions](decisions/README.md), and this file keeps only the requirements and the history of the move.

## Why

- **Turso usage was out of proportion.** Every request to an account loaded all of the user's rows and wrote every row back, about 1,540 reads and 3,080 writes per request for one user, with a log that never shrank.
- **Requests were slow.** A sync took about 2.9 s at the median in production, almost all of it in 29 HTTP round trips to Turso. A change took about 7 s to reach another device.
- **The sync engine was ours.** Clocks, the outbox, the merge, paging, the realtime nudge, and their Swift ports were about 2,000 lines plus 1,600 lines of tests, and their bugs kept coming (8 `fix(sync)` commits in 10 days).

## Requirements

Stefan's requirements:

1. **Fully offline.** Reading and writing work with no network, and the data survives app restarts.
2. **Live sync.** Every client sees another client's change within about a second while both are online.
3. **Fast.** The UI reacts to a local change on the first frame. The server does a few database calls per write, not a reload of the whole account.
4. **No sync engine of our own.** An off-the-shelf product syncs and settles conflicts.
5. **One database.** Postgres replaces Turso and the `Account` Durable Object's SQLite.
6. **An ORM for everything the app does.** Every query and write during normal operation goes through an ORM: Drizzle on the server and the web, GRDB records on iOS. Migrations and one-time setup may use SQL.
7. **Shared types from the database schema.** `shared/db/schema.ts` produces the types of every client, in TypeScript and Swift.
8. **Everything testable locally on a Mac in dev mode.** The server, sync, the web, and the iOS simulator run against local services with no cloud account.
9. **Simpler than before.** Any piece the new stack makes unnecessary goes, rather than being kept for compatibility.

Constraints from the product and the repo:

10. **Clients.** Web is a Svelte SPA, iOS is native Swift, and an Apple Watch app comes later, so sync must work from Swift.
11. **Many users, one today.** ProcrastiMate is a multi-user app that has one user until it launches, so the design may favor one user's numbers but never assume a single user. Sharing, public links, and AI accounts keep working.
12. **The existing pieces stay.** The Cloudflare Worker, the oRPC contract, the agent API, Sentry, and the single-origin rule (the browser talks only to the app's origin).
13. **Cheap.** Free tiers at today's usage.
14. **No backwards compatibility.** A hard cutover with a one-time import of production data.
15. **Isolated local runs.** Parallel worktrees each get their own data. CI and cloud agents have no AWS access, and nothing local touches production or a shared database.

## Target design

```
iOS (GRDB) ─┐                      ┌─ Worker /api/powersync/* ─→ PowerSync service ─┐
            ├─ local SQLite ←sync──┤                                                 ├─ logical replication ← Postgres
web (Drizzle)┘     │ upload queue  └─ Worker POST /api/upload ─→ Drizzle ─────────────────────────────────→ (Supabase)
```

- **Postgres on Supabase, as plain Postgres.** Only the database: no Supabase Auth, REST API, or Realtime. Tables live in `public` with row level security on and no policies, so the Data API serves nothing, and the server connects as the owner. A Neon compute would never sleep while PowerSync holds its replication slot, so Neon would bill around the clock.
- **The Worker reaches Postgres through Hyperdrive.** Drizzle runs on `postgres` (postgres.js) over the Hyperdrive binding. Locally the same code connects straight to the local Postgres.
- **PowerSync Cloud syncs.** It reads Postgres through logical replication and streams each user's rows to the device. Sync Streams in `powersync/sync-config.yaml` say which rows each user gets. The browser and iOS reach it through `/api/powersync/*` on the Worker, which forwards the stream, so the single-origin rule holds.
- **Writes go up through one route.** Each client's PowerSync upload queue sends its pending changes to `POST /api/upload`. The route checks each change against the actor's access, stamps authorship and the editing app, applies the changes in one Drizzle transaction, runs the repairs that keep the data valid (`fixups`), records activity, and replans push notifications. PowerSync then streams the result back to every device, the writer's included.
- **Conflicts are the last write to arrive.** A change carries only the columns it changed, so edits to different fields of one task both survive. Two edits to the same field keep whichever reached the server last. A delete removes the row, so a later edit to it changes nothing, and undoing a delete inserts the row again. Per-field clocks are gone.
- **Auth stays Better Auth.** Moving users to another provider would mean moving scrypt password hashes and Google and Apple identities, which nothing here can test. The Worker signs a short-lived EdDSA token for PowerSync with its own key, and each PowerSync config lists the public key, so PowerSync never calls back into the Worker.
- **Clients keep their synchronous store.** Both clients render from an in-memory snapshot, and every store command stays a synchronous function from one snapshot to the next. After a command, the client writes the rows that changed to the local database through its ORM, and PowerSync queues them for upload. When PowerSync applies changes from the server, the client reloads the snapshot from the local database. The local database replaces the `localStorage` document on the web and the JSON file on iOS.
- **Shared spaces are rows, not sections.** Every row keeps `user_id`, the owner of its space. A device's database holds its own rows and the rows other spaces share with it, and the client groups them by owner. The server keeps an `access` table, the ids each grantee may see and whether they may edit, recomputed with `scopeOf` whenever a space's data or shares change. Sync Streams read it, so the stream rules stay simple and the scope logic stays in TypeScript.
- **The Durable Object keeps only Ramble.** The realtime nudge, the account store, and the per-space queue go away. A Worker cron sends due Web Push notifications every minute from schedules the upload route writes. Ramble keeps its object, because a Durable Object's CPU budget resets per WebSocket message.
- **Image bytes stay in the database, outside sync.** The `images` table holds bytes as `bytea`, and the PowerSync publication leaves it out.
- **One generator for every type.** `bun run generate` reads the `pg-core` schema and writes the web's `sqlite-core` tables and PowerSync schema, the Swift row types with their GRDB conformances and the PowerSync Swift schema, and the Zod, OpenAPI, and Swift API types as today.
- **Local dev runs on Docker.** One Postgres container serves every worktree, each with its own database, and each worktree runs its own PowerSync container on a port from its block. Server unit tests run on PGlite, Postgres compiled to WebAssembly, in the test process. CI runs the same containers as service containers.

### What goes away

- Turso, `@libsql/client`, the Turso backup cron, and `server/src/account/turso.ts`, `serial.ts`, and the Ramble ledger workaround.
- The sync protocol: `POST /api/sync`, the HLC, the outbox, `merge`, `applyChanges`, `settle`, `seedPatches`, paging, the epoch and reset, `log.seq`, `clocks`, `deleted` tombstones, the realtime socket, and the Swift `SyncEngine`.
- The `Account` object's store and router, the actor header, the internal contract, `memberships`, `devices`, and `meta`.
- The web's `localStorage` document and iOS's JSON document, with their validation and migration rules.

### What stays

- Every store rule in `shared/` and its Swift port, `diff` (now turning two snapshots into row writes), `fixups` without clocks, `scopeOf` and `admit`, activity read from the server's log, `task_clients`, the agent API, public links, AI accounts and their tokens, images and their upload queues, Ramble, and Web Push.

## Questions the proof of concept answers

The proof of concept lived in `poc/` until the migration landed, and its answers are in that commit's `poc/README.md`.

1. Does PowerSync accept a token the server signs, locally and in the cloud?
2. Do the PowerSync web SDK and `@powersync/drizzle-driver` run in the SvelteKit build in Chromium and WebKit, and can Drizzle with the `sqlite-core` tables read and write them?
3. Does the PowerSync Swift SDK with GRDB build for the iOS simulator, do GRDB records insert, update, and delete through PowerSync's views, and does a watch fire when changes sync in?
4. Can the Worker forward `/api/powersync/*` to PowerSync, streaming included?
5. Do Sync Streams over the `access` table deliver exactly the shared rows, and drop them when a share is revoked?
6. How long does a change take to reach another device, locally and in the cloud?
7. Does Hyperdrive's local connection string let `wrangler dev` use the local Postgres?
8. Does the upload route see each change's operation, table, id, and changed columns, and does a refused change revert on the device?
9. How much memory does one PowerSync container use, which decides whether every worktree can run one?

## Order of the work

1. This file.
2. The proof of concept in `poc/`.
3. The `pg-core` schema, its migration, and the generator.
4. The server: Postgres, Better Auth with JWT, the upload route, access, the agent API, activity, images, push, and Ramble.
5. Local dev: Docker in `scripts/setup-worktree.ts`, teardown, CI services, and PGlite tests.
6. The web client on PowerSync and Drizzle.
7. The iOS client on PowerSync and GRDB.
8. Deleting the old engine, Turso, and the account store.
9. The area files under `docs/decisions/` and the feature map.
10. A one-time import of production data from Turso, kept out of git, that compares every row after it copies.
11. Deleting `poc/`.
