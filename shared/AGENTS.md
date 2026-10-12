# Shared contracts

- A type more than one client needs is a Zod schema with an `id` (`.meta({ id })`), and its TypeScript type is `z.infer` of it. The generator writes the Swift from it. `x-` keys in the metadata shape the Swift; see `scripts/generate/swift.ts`.
- `db/schema.ts` is the Drizzle schema for the server's tables and the source of truth for every type a table stores. Derive types from it or from `db/generated/zod.ts`, which `bun run generate` writes from it; never restate a row's shape in Zod. `values.ts` and `db/json.ts` hold the shapes inside JSON columns. `api/contract.ts` is the oRPC contract for every endpoint, and `api/generated/openapi.json` is generated from it; never edit it by hand.
- Keep shared types and domain helpers here. Both TypeScript apps resolve `shared/*` through the root tsconfig.
- Keep this folder independent of app-specific environment readers, server-only code, and browser frameworks. Each app owns its env-manager target.
- Logic both clients use lives here, ported to Swift in `app-ios/Sources/Core`. Tests of a ported module wrap each function with `recorded('<module>', fn)` and import `describe` and `test` from `./vectors/record.ts`, so every call becomes a test vector. After changing behavior, run `bun run vectors` and commit `shared/vectors/`; CI fails when it is stale, and the iOS `VectorTests` fail until the Swift port matches.
