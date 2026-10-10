# API server

- Routes live in `src/api.ts`, mounted at `/api/*`. It exports one fetch handler that `src/index.ts` serves with Bun in development and the Cloudflare Worker runs in production, so keep it free of Bun and Node APIs. Run `bun run start:server` from the root, or `bun run start` here.
- Import settings from generated `src/env.ts` in `src/index.ts` only; the Worker has no env reader. Declare server-only secrets in the server scope of the root `.env`; edit values only in root `.env.local` and run `env-manager gen --local`.
- Browser `/api/status` reaches the same `/api/status` route through the Vite proxy in development and on the Worker in production. Shared contracts belong in `../shared/`; keep them independent of server configuration.
