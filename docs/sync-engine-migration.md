# sync-engine migration

ProcrastiMate drops Postgres, Supabase, Hyperdrive, Docker, and PowerSync for [sync-engine](https://github.com/smirea/sync-engine), the SQLite sync engine a-better-me already runs on. This file holds the requirements, the target design, and the order of the work. Once the move lands, the area files in `docs/decisions/` carry the decisions and this file goes.

## Why

- **The server is not a server.** sync-engine runs on one Durable Object with SQLite storage. There is no managed database, no replication slot, and no sync service to provision, and the free PowerSync instance that deprovisions itself when idle (dev, 2026-10-26) is gone with it.
- **Local runs need no services.** The Bun dev server and the unit tests run on `bun:sqlite`. No Docker Postgres, no PowerSync container per worktree, no PGlite.
- **One engine across our apps.** a-better-me and ProcrastiMate share the engine, its Bend model, its conformance vectors, and its Swift client.

## Requirements

1. **Works exactly the same.** Every user-facing feature in `.cursor/skills/verify-procrastimate/features/` behaves as before: offline reads and writes, live sync within about a second, sharing with people, AI accounts and public links, comments, activity, images, push, Ramble, the agent API, Todoist import, Notouroboros memos.
2. **Production data moves whole.** Every row of production Postgres lands in the new store, Better Auth's users, accounts and sessions included, so nobody signs in again. Counts and the agent `/view` match before and after.
3. **No backwards compatibility.** A hard cutover. Old migrations, Docker, PowerSync configs, and the Postgres code go.
4. **Free tier.** Workers free plan, SQLite Durable Objects, R2.

## Target design

```
iOS (GRDB + SyncEngine) ─┐                         ┌─ Worker ─ /api/* ─→ Durable Object `App` (SQLite)
                         ├─ POST /api/sync, /live ─┤                      ├─ sync-engine space: synced tables, _changes, _clients, _log
web (sqlite-wasm worker) ┘                         │                      ├─ server tables: log, push, shares, api_tokens, images, ramble_usage
                                                   │                      └─ Better Auth tables
                                                   └─ /api/ramble/socket ─→ Durable Object `Ramble` (unchanged)
```

- **One database, one Durable Object.** Every user's rows, the server-only tables, and Better Auth's live in the SQLite of one object, `App`, named `main`. That is the shape Postgres had: one database every rule reads in one transaction. Guest admission, the `access` recompute, the push plan, and the purge stay single transactions, and they no longer need advisory locks, savepoints, or batching, because an object runs one request at a time and its SQL is synchronous. One space per user was rejected: it makes every cross-user rule a call between objects and every client a multi-space client, for a product with one user.
- **The Worker routes, the object serves.** The Worker serves static assets, forwards `/api/*` to `App`, and keeps Ramble's socket on its own object. The whole API (oRPC, Better Auth, images, sync) runs in `App` over Drizzle `durable-sqlite`. The Bun dev server runs the same handler over `bun:sqlite` in `.data/`; tests run it over `:memory:`.
- **Drizzle `sqlite-core` is the one schema.** `shared/db/schema.ts` becomes `sqlite-core`, and sync-engine's `defineSchema` takes the synced tables from it with the Zod shapes of `shared/db/json.ts` as column validators. The web's Drizzle runs on the same tables, and `generate()` writes `SyncSchema.swift`. Ids stay text primary keys, so the two per-user composite keys change: `settings.id` is the user id and `reads.id` is `<user>:<task>`.
- **Writes are row writes through the engine.** Clients write their local SQLite, the engine's triggers capture the change, and `POST /api/sync` carries it. The server's rules become engine hooks that run inside the sync transaction with the request's actor: `admit` (ownership, guest admission with `guestRefusal`, comment authorship, authorship stamps, settings never overwritten) and `landed` (the `log` row with actor and client, the `access` recompute, the push plan, the purge). The agent API writes through the same hooks with `space.write`, so there is one write path again.
- **Pulls are filtered per reader.** The space holds every user's rows, so the server filters each pull to what the reader sees: their own rows, their `access` rows, and the rows those name, comments through their task. When a reader's `access` rows change, the delta adds the rows they now see and tombstones the ones they lost. This is a server-side engine option; the clients and the protocol stay as they are.
- **Images move to R2.** Bytes go to an R2 bucket under `images/<user>/<id>/<size>`, metadata stays a table. A Durable Object row caps at 2 MB.
- **Backups are the dump.** The daily cron writes the object's tables to R2 as `sqlite/<date>.json`, and the same format restores an empty object. The production import is one such file built from Postgres.

## What goes away

Postgres, PGlite, postgres.js, Hyperdrive, Supabase, Docker compose, `powersync/`, `@powersync/*`, `POWERSYNC_*` and `DATABASE_URL` settings, `server/drizzle/` and the migrator, `/api/upload`, `/api/powersync/*`, `/api/sync/token`, `procrastimate_changes`, `ps_crud` readers, and the PowerSync Swift packages.

## Order of the work

1. Engine: `admit` and `landed` hooks with a request context, `space.write`, per-reader pull filtering, web `rejected` status. With tests in the engine repo.
2. Schema and server port to `sqlite-core` and the `App` object, tests on `bun:sqlite`.
3. Web client on `sync-engine/client-web`.
4. iOS client on the Swift `SyncEngine`.
5. Import tool: production Postgres to a dump file, restored into an empty object; compared row by row and through `/view`.
6. Cleanup, docs, cutover: dump, deploy, restore, verify on web and iOS against production.
