# Web client

- Svelte 5 (runes) and SvelteKit 3 as a client-only SPA. Routes live in `src/routes/`, shared UI and state in `src/lib/` (imported as `#lib/*`), and Tailwind CSS in `src/index.css`. Domain types and the quick add parser come from `shared/*`.
- SvelteKit config is passed to the `sveltekit()` plugin in `vite.config.ts`; there is no `svelte.config.js`.
- Run `bun run start:client` from the root, or `bun run start` here. Scripts pass `--env-file=.env.local` explicitly because Bun skips env autoloading when it runs Vite through its `node` shim. `env.ts` is the generated Node-side reader for `vite.config.ts`; browser code must not import it.
- `bun run check` runs `svelte-check` with this package's TypeScript 6. `bun run test:e2e` runs Playwright (`e2e/*.e2e.ts`) against a dev server on port 6130 with the browser clock pinned. The `desktop` project runs in Chromium and the `mobile` project runs `e2e/mobile.e2e.ts` in WebKit as an iPhone 15 Pro. Install both browsers once with `bunx playwright install --with-deps chromium webkit`.
- The UI is mobile first. Check every UI change at 393 px wide as well as on desktop, and keep tap targets at 44 px with the `touch:` variant or the `hit-area` class.
- Browser API requests use `/api/*`; Vite proxies to the root schema's `API_URL` and strips `/api`. The browser only talks to its own origin: never expose an API host or port to browser code, and self-host fonts and assets instead of loading them from a third party.
- Edit schema and values at the repo root. Run `env-manager gen --local` to update child outputs; do not maintain a child `.env` schema or import the env reader into browser code.
