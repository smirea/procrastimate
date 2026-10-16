# Client and server

Bun API in `server/`, Svelte 5 + SvelteKit + Vite in `app-web/`, and shared TypeScript contracts in `shared/`. Each app owns its entry points and generated environment reader; shared code should stay independent of app configuration.

```sh
bun install
env-manager gen --local
bun run start                  # web client and API, with watch/reload
bun run start:client
bun run start:server
bun test                       # unit tests
bun run check                  # typecheck root and app-web
bun run test:e2e               # Playwright desktop and iPhone suites (bunx playwright install --with-deps chromium webkit once)
bun run preview                # build and serve the production Worker locally with wrangler dev
```

The client proxies `/api/*` to the API unchanged, so `/api/status` reaches the server's `/api/status`. The local web hostname and ports are configured during scaffolding; inspect the root `.env` for defaults.

## Deploys

Production is one Cloudflare Worker (`wrangler.jsonc`) on the free plan at `https://procrastimate.stf.lol`, a Workers Custom Domain. It serves `app-web/build` as static assets and runs `server/src/api.ts` for `/api/*`. `.github/workflows/ci.yml` checks every pull request and deploys every push to `master` with `wrangler deploy`.

Deploys need two repository secrets in GitHub, mirrored from env-manager (see Secrets):

- `CLOUDFLARE_ACCOUNT_ID`, the Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`, an API token made from the "Edit Cloudflare Workers" template, with the `stf.lol` zone included so `wrangler deploy` can attach the custom domain.

Without them CI still passes and skips the deploy with a warning. Deploys never write or delete Worker secrets.

## Secrets

Every secret lives in env-manager project `procrastinate` in AWS Secrets Manager. Two environments, and no `local` environment or local mode: `prod` for the Worker (`BETTER_AUTH_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, all required, and the optional `ELEVENLABS_API_KEY` and sign-in providers), the deploy credentials, the Turso platform token `TURSO_API_TOKEN`, and Release iOS; `dev` for local development and Debug iOS. Worker secrets are optional fields in the root `.env` schema's `server` scope, and `server/src/config.ts` enforces the required ones. The other credentials sit in the `scripts` scope. Never run `wrangler secret put` or `gh secret set` by hand; `server/scripts/secrets.ts` is the one bridge, and it prints key names only.

```sh
bun run secrets:push     # set prod Worker secrets with wrangler secret bulk; unset keys are left alone
bun run secrets:github   # mirror CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from prod to GitHub
bun run secrets:check    # compare names in env-manager prod, on the Worker, and in GitHub; exits 1 on drift
bun run env:pull         # env-manager down: fetch the selected env into root .env.local
bun run env:ios          # write Debug (dev) and Release (prod) API_URL into app-ios/Config/Env.xcconfig
```

To change a prod secret, on a machine with AWS access (Stefan's MacBook):

```sh
env-manager env set prod
env-manager down                 # root .env.local now holds prod values
$EDITOR .env.local
env-manager up
bun run secrets:push             # and/or: bun run secrets:github
bun run env:ios                  # refresh Debug and Release after an API_URL change
env-manager env set dev && env-manager down   # back to dev values
```

On a new machine, `env-manager env set dev && env-manager down` fetches `dev` and regenerates the child files. Cloud agents and the dev box have no AWS access; they run `env-manager gen --local` (schema defaults, not an environment named local), and end to end tests use the hard-coded `e2e-setup-code`.

## Environment

`env-manager` manages one root `.env` schema with directory targets. The root `.env.local` is the only place to edit values for the selected environment. `env-manager up` stores them and regenerates `app-web/.env.local`, `server/.env.local`, `server/src/env.ts`, and `app-web/env.ts` (SvelteKit reserves `src/env.ts`). Commands from child directories find the owning root. There are no independent child schemas.

The schema is stored in AWS. `env-manager down` fetches the selected environment and regenerates the child files; `env-manager up` writes the current one back. See `env-manager --help` for schema types and target selection. `gen --local` is only for a machine with no AWS credentials.

Keep `.env` and generated TypeScript readers tracked. Ignore all `.env.local` files and generated Swift values. Read server configuration through `server/src/env.ts`; the client's reader is for Vite's Node-side configuration, not browser code. Browser requests use `/api` and must never import server secrets or the environment reader.

## iOS app

`app-ios/` contains the iOS 27 SwiftUI app, its Xcode project, the `Core` Swift package, and the executable `scripts/run` launcher. `swift test` in `app-ios/` runs the `Core` tests on macOS or Linux. The iOS workflow (`.github/workflows/ios.yml`) builds the app and runs its UI tests on a simulator.

```sh
bun run start:ios --targets
bun run start:ios -t simulator
bun run start:ios -t "iPhone 17" --no-watch
```

`app-web/` contains the web client. `start:client` runs it; `start` runs the web client and API; launch iOS separately with `start:ios`. Arguments pass through to `app-ios/scripts/run`. See `app-ios/README.md` and `app-ios/AGENTS.md` for native development and signing.

The root `.env` declares `app-web format=ts path=.env.local generate=env.ts`, `server format=ts path=.env.local generate=src/env.ts`, and `app-ios format=swift path=Config/LocalSecrets.xcconfig`. Paths are relative to each target directory. Debug iOS reads `dev` and Release iOS reads `prod`, via `bun run env:ios` (`Config/Env.xcconfig`). Release is pinned to `https://procrastimate.stf.lol`. `API_URL` is shared by Vite's proxy and the native app; read it in Swift with `AppEnvironment.apiURL`. A physical device needs `dev`'s `API_URL` set to a reachable host, then `bun run env:ios`: `127.0.0.1` points at the device itself. Client and native configuration ships to users, so keep credentials scoped to the server.
