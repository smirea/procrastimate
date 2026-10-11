# API server

- Routes live in `src/api.ts`, mounted at `/api/*`. It exports one fetch handler that `src/index.ts` serves with Bun in development and the Cloudflare Worker runs in production, so keep it free of Bun and Node APIs. Run `bun run start:server` from the root, or `bun run start` here.
- Import settings from generated `src/env.ts` in `src/index.ts` only; the Worker has no env reader. Declare server-only secrets in the server scope of the root `.env`; edit values only in root `.env.local` and run `env-manager gen --local`.
- Browser `/api/status` reaches the same `/api/status` route through the Vite proxy in development and on the Worker in production. Shared contracts belong in `../shared/`; keep them independent of server configuration.
- `src/account/` holds the `Account` Durable Object, the one synced account, over the `AccountStore` interface: SQLite on the Worker, in memory on the Bun dev server (lost on restart). `src/auth.ts` is the only code that reads device tokens; other account routes call its `authenticate`. `src/account/sync.ts` serves `POST /api/sync` with the merge from `shared/sync/`. Worker bindings and secrets are typed in `src/bindings.ts`.
