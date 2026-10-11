# Shared contracts

- Keep shared types and domain helpers here. Both TypeScript apps resolve `shared/*` through the root tsconfig.
- Keep this folder independent of app-specific environment readers, server-only code, and browser frameworks. Each app owns its env-manager target.
- Logic both clients use lives here, ported to Swift in `app-ios/Sources/Core`. Tests of a ported module wrap each function with `recorded('<module>', fn)` and import `describe` and `test` from `./vectors/record.ts`, so every call becomes a test vector. After changing behavior, run `bun run vectors` and commit `shared/vectors/`; CI fails when it is stale, and the iOS `VectorTests` fail until the Swift port matches.
