# Decisions

- Read [`docs/decisions/README.md`](docs/decisions/README.md) and the area files your work touches before starting. They hold the product's concepts, goals, paradigms, and high-level system decisions, one file per area.
- Whenever a new concept, goal, paradigm, or high-level system decision comes up, record it in the matching area file under `docs/decisions/` in the same PR as the work. Add a new file and list it in the index when no area fits.

# Workflow

Full rules in [`docs/decisions/workflow.md`](docs/decisions/workflow.md).

- One PR per thread, never stacked. Fold small same-area follow-ups into an open PR instead of starting a new thread.
- Rebase only when GitHub reports a real conflict; PR CI already tests the merge with `master`.
- Build features yourself; never hand the whole build to a helper sub-agent that can't receive messages.
- Run only the relevant unit and e2e specs locally; CI runs the full suite.
- Screenshots: 2 to 4, only for UI changes.
- Build every feature for all clients at once (web and iOS today); each plan names its target clients and why any are excluded.

# Product

- ProcrastiMate is Stefan's personal task manager, a rough Todoist clone that will grow. One user. Web and iOS now, Apple Watch later.
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
- `bun run generate` writes the generated API types, OpenAPI document, and migration bundle; `bun run start` keeps them current and `bun run build` runs it first. `bun run db:generate` adds a migration after a schema change.
- In a fresh git worktree, run `bun scripts/setup-worktree.ts` first: it installs, writes offline env files with an in-memory database, assigns the worktree its own ports, and writes a git-ignored `./sim` that runs the app on the worktree's own simulator, so parallel agents don't collide. `bun scripts/teardown-worktree.ts <branch>` removes it all from the main checkout once the PR is merged.
- `bun test` runs unit tests. `bun run check` typechecks the root and `app-web`. `bun run test:e2e` runs the Playwright suite against its own dev server on `CLIENT_PORT + 10` (6130 in the main checkout). With `E2E_WORKER=1` it runs against `wrangler dev` serving an existing `bun run build`.
- Production is one Cloudflare Worker configured by `wrangler.jsonc`. `bun run preview` builds and serves it locally with `wrangler dev`. CI in `.github/workflows/ci.yml` deploys every push to `master`; never deploy by hand.
- A `monorepo-swift` scaffold also has `app-ios/` with native instructions and its own launcher. See that folder's docs.

# Environment

- Use env-manager's root `.env` schema and named directory targets. Values live in AWS, in environments `dev` and `prod`. Edit them in the root `.env.local` after `env-manager down`, then `env-manager up`. Child values and readers are generated projections, not independent configs.
- `local:true` keeps generation offline and disables automatic Git updates. Use `env-manager --help` for target selection, schema types, and remote storage.
- Read application settings through each TypeScript target's generated reader: `server/src/env.ts`, and `app-web/env.ts` because SvelteKit reserves `src/env.ts`. The client's reader runs only in Vite's Node context; browser code must not import it.
- Keep schema and readers tracked, values files ignored, and secrets scoped to the server target. Native and browser settings are public.
- All secrets live in env-manager project `procrastinate` on AWS. Two environments, and no `local` environment or local mode: `prod` for the Worker, deploys, and Release or TestFlight iOS, and `dev` for local development and Debug iOS. Never run `wrangler secret put` or `gh secret set` directly. Change the value in env-manager, then run `bun run secrets:push` / `secrets:github` from a machine with AWS access (the agent box, whose `grok-bot` IAM user reaches it, or Stefan's MacBook). `bun run env:ios` writes the Debug and Release `API_URL`s. Cloud agents have no AWS access: they run `env-manager gen --local` against the schema defaults for `dev`, and end to end tests sign in with email and password against the in-memory auth database.

# Native app

- SwiftUI lives in `app-ios/`; read its `AGENTS.md` for native development. The root `start:ios` script delegates to `app-ios/scripts/run` and forwards launcher arguments.
- The web client lives in `app-web/`. Root `start` runs it and the server together. `start:client` and `start:server` run each individually; iOS runs separately.
- The root env-manager schema declares each directory target with explicit output paths: TypeScript values at `.env.local` and readers at `src/env.ts` (`env.ts` for `app-web`), native values at `Config/LocalSecrets.xcconfig`. Debug and Release iOS builds read `Config/Env.xcconfig`, written by `bun run env:ios` from `dev` and `prod`. Never hand-edit either xcconfig.
- `Config/Base.xcconfig` and `Config/Info.plist` bridge selected settings into `AppEnvironment.apiURL`. Native settings are bundled; server credentials belong exclusively to the server target.

- Stefan's live tasks are reachable through the agent API. `APP_BOT_API_URL` (production API base) and `APP_BOT_TOKEN` (an AI-account bearer token) live in env-manager under the `scripts` target, in `dev` and `prod`. To start exploring:
  1. Load them from the root `.env.local` (run `env-manager env set dev && env-manager down` first if they're missing; never `up`).
  2. Read the public overview with `curl -s "$APP_BOT_API_URL/docs"`, then the full guide with `curl -s -H "Authorization: Bearer $APP_BOT_TOKEN" "$APP_BOT_API_URL/docs/agent"`. The OpenAPI spec is at `/docs/openapi`.
  3. Everything else, such as routes, examples, and what an AI account can't do, is in that guide. Writes land in Stefan's real data, so read with `GET /view` before changing anything.

- Local web host: procrastimate.localhost -> 6120; browser API calls use the /api proxy.
