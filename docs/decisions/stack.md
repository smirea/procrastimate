# Stack

- **Tooling.** Bun and TypeScript. Oxlint, oxfmt, and Lefthook for linting and hooks.
- **Web client.** Svelte 5 (runes) with SvelteKit 3 as a client-only single-page app (`ssr = false`, static adapter with an `index.html` fallback), Vite, and Tailwind CSS. Chosen for a small runtime, fine-grained reactivity, and built-in transitions and FLIP animations that suit the snappy, animated UX. React and TanStack Router are gone.
- **TypeScript versions.** The root uses TypeScript 7 (`tsc`) for `server/` and `shared/`. `app-web/` pins TypeScript 6 because SvelteKit and `svelte-check` need the TypeScript JS API, which TypeScript 7 does not ship. Bun's isolated linker keeps the two apart.
- **Generated env readers are committed as env-manager writes them.** CI pins the env-manager commit every machine runs, and oxfmt ignores the readers, so `env-manager gen --local` leaves a fresh worktree clean. Bump the pin in `.github/actions/setup/action.yml` and commit the new readers together.
- **Web env reader.** SvelteKit 3 reserves `src/env.ts`, so env-manager generates the web client's Node-only reader at `app-web/env.ts`. Scripts pass `--env-file=.env.local` because Bun does not auto-load env files when it runs Vite through its `node` shim.
- **Server.** One fetch handler in `server/src/api.ts` that owns every `/api/*` route. Bun.serve runs it in development, and the Cloudflare Worker runs the same module in production. Task data lives in Turso or the user's `Account` Durable Object.
- **Database and API.** Drizzle for every table, Better Auth's included, and an oRPC v2 contract with OpenAPI for every HTTP endpoint. Drizzle is the source of truth for every type a table stores. The web client is typed from the contract, and iOS gets generated Swift types. See [API and database types](api.md).
- **Shared domain code.** Environment-independent types and logic, including the natural-language parser, live in `shared/` so the server can reuse them.
