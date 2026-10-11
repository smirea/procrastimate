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

Every secret lives in env-manager project `procrastimate` in AWS Secrets Manager: env `production` for the Worker (`SYNC_SETUP_CODE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ELEVENLABS_API_KEY`) and the deploy credentials, env `local` for dev. They are optional fields in the root `.env` schema's `server` scope, so `env-manager gen --local` works without them. Never run `wrangler secret put` or `gh secret set` by hand; `server/scripts/secrets.ts` is the one bridge, and it prints key names only.

```sh
bun run secrets:push     # set production Worker secrets with wrangler secret bulk; unset keys are left alone
bun run secrets:github   # mirror CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to GitHub
bun run secrets:check    # compare names in env-manager, on the Worker, and in GitHub; exits 1 on drift
bun run env:pull         # env-manager down --no-local: fetch the current env into root .env.local
```

To change a production secret, on a machine with AWS access (Stefan's MacBook):

```sh
env-manager env set production
env-manager down --no-local      # root .env.local now holds production values
$EDITOR .env.local
env-manager up --no-local
bun run secrets:push             # and/or: bun run secrets:github
env-manager env set local && env-manager down --no-local   # back to dev values
```

On a new machine, `env-manager down --no-local` fetches the local env and regenerates the child files. Cloud agents and the dev box have no AWS access; they run `env-manager gen --local`, and end to end tests use the hard-coded `e2e-setup-code`.

## Environment

`env-manager` manages one root `.env` schema with directory targets. The root `.env.local` is the only place to edit local values. Run `env-manager gen --local` after editing either file; it generates `app-web/.env.local`, `server/.env.local`, `server/src/env.ts`, and `app-web/env.ts` (SvelteKit reserves `src/env.ts`). Commands from child directories find the owning root. There are no independent child schemas.

The scaffold runs `env-manager init --local` and `env-manager gen --local`. Persistent `local:true` keeps setup offline and avoids automatic Git commits. See `env-manager --help` for schema types, target selection, and opting into remote storage with `--no-local`.

Keep `.env` and generated TypeScript readers tracked. Ignore all `.env.local` files and generated Swift values. Read server configuration through `server/src/env.ts`; the client's reader is for Vite's Node-side configuration, not browser code. Browser requests use `/api` and must never import server secrets or the environment reader.

## iOS app

`app-ios/` contains the iOS 26 SwiftUI app, its Xcode project, the `Core` Swift package, and the executable `scripts/run` launcher. `swift test` in `app-ios/` runs the `Core` tests on macOS or Linux. The iOS workflow (`.github/workflows/ios.yml`) builds the app and runs its UI tests on a simulator.

```sh
bun run start:ios --targets
bun run start:ios -t simulator
bun run start:ios -t "iPhone 17" --no-watch
```

`app-web/` contains the web client. `start:client` runs it; `start` runs the web client and API; launch iOS separately with `start:ios`. Arguments pass through to `app-ios/scripts/run`. See `app-ios/README.md` and `app-ios/AGENTS.md` for native development and signing.

The root `.env` declares `app-web format=ts path=.env.local generate=env.ts`, `server format=ts path=.env.local generate=src/env.ts`, and `app-ios format=swift path=Config/LocalSecrets.xcconfig`. Paths are relative to each target directory. `env-manager gen --local` projects its selected values into `app-ios/Config/LocalSecrets.xcconfig`. `API_URL` is shared by Vite's proxy and the native app; read it in Swift with `AppEnvironment.apiURL`. Configure a reachable API host in the root `.env.local` for physical devices: `127.0.0.1` points at the device itself. Regenerate and rebuild after changing values. Client and native configuration ships to users, so keep credentials scoped to the server.
