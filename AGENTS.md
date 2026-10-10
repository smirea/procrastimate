# Decisions

- Read [`docs/decisions.md`](docs/decisions.md) before starting work. It holds the product's concepts, goals, paradigms, and high-level system decisions.
- Whenever a new concept, goal, paradigm, or high-level system decision comes up, record it in `docs/decisions.md` in the same PR as the work.

# Product

- Procrastimate is Stefan's personal task manager, a rough Todoist clone that will grow. One user. Web and iOS now, Apple Watch later.
- Local first and synced, extremely snappy, with subtle, satisfying animations. Never keep backwards compatibility.
- `.cursor/skills/verify-procrastimate/features/` maps every user-facing feature. Read it before you build a feature, and update it in the same change.

# Stack

- Tooling: Bun + TypeScript
- Server: Bun.serve API
- Client: Svelte 5 + SvelteKit 3 (client-only SPA) + Vite
- UI: Tailwind CSS (enabled in `app-web/src/index.css`)
- Linting and Hooks: Oxlint + Lefthook

# Structure and commands

- `app-web/` owns Svelte, routes, styles, and Vite. `server/` owns the Bun API. `shared/` holds environment-independent types and contracts. Read each folder's `AGENTS.md` before changing it.
- `bun run start` runs client and server; `start:client` and `start:server` run them separately. Browser API calls use the client-relative `/api` proxy.
- `bun test` runs unit tests. `bun run check` typechecks the root and `app-web`. `bun run test:e2e` runs the Playwright suite against its own dev server on port 6130.
- A `monorepo-swift` scaffold also has `app-ios/` with native instructions and its own launcher. See that folder's docs.

# Environment

- Use env-manager's root `.env` schema and named directory targets. Edit values only in the root `.env.local`, then run `env-manager gen --local`. Child values and readers are generated projections, not independent configs.
- `local:true` keeps generation offline and disables automatic Git updates. Use `env-manager --help` for target selection, schema types, and remote storage.
- Read application settings through each TypeScript target's generated reader: `server/src/env.ts`, and `app-web/env.ts` because SvelteKit reserves `src/env.ts`. The client's reader runs only in Vite's Node context; browser code must not import it.
- Keep schema and readers tracked, values files ignored, and secrets scoped to the server target. Native and browser settings are public.

# Native app

- SwiftUI lives in `app-ios/`; read its `AGENTS.md` for native development. The root `start:ios` script delegates to `app-ios/scripts/run` and forwards launcher arguments.
- The web client lives in `app-web/`. Root `start` runs it and the server together. `start:client` and `start:server` run each individually; iOS runs separately.
- The root env-manager schema declares each directory target with explicit output paths: TypeScript values at `.env.local` and readers at `src/env.ts` (`env.ts` for `app-web`), native values at `Config/LocalSecrets.xcconfig`. Regenerate the nested xcconfig with `env-manager gen --local`; never hand-edit `app-ios/Config/LocalSecrets.xcconfig`.
- `Config/Base.xcconfig` and `Config/Info.plist` bridge selected settings into `AppEnvironment.apiURL`. Native settings are bundled; server credentials belong exclusively to the server target.

- Local web host: procrastimate.localhost -> 6120; browser API calls use the /api proxy.
