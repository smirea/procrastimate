# Stack

- **Tooling.** Bun and TypeScript. Oxlint, oxfmt, and Lefthook for linting and hooks.
- **Web client.** Svelte 5 (runes) with SvelteKit 3 as a client-only single-page app (`ssr = false`, static adapter with an `index.html` fallback), Vite, and Tailwind CSS. Chosen for a small runtime, fine-grained reactivity, and built-in transitions and FLIP animations that suit the snappy, animated UX. React and TanStack Router are gone.
- **TypeScript versions.** The root uses TypeScript 7 (`tsc`) for `server/` and `shared/`. `app-web/` pins TypeScript 6 because SvelteKit and `svelte-check` need the TypeScript JS API, which TypeScript 7 does not ship. Bun's isolated linker keeps the two apart.
- **Web env reader.** SvelteKit 3 reserves `src/env.ts`, so env-manager generates the web client's Node-only reader at `app-web/env.ts`. Scripts pass `--env-file=.env.local` because Bun does not auto-load env files when it runs Vite through its `node` shim.
- **Server.** One fetch handler in `server/src/api.ts` that owns every `/api/*` route. Bun.serve runs it in development, and the Cloudflare Worker runs the same module in production. It holds no task data. Its only state is the push schedule each device sends it.
- **Shared domain code.** Environment-independent types and logic, including the natural-language parser, live in `shared/` so the server can reuse them.
