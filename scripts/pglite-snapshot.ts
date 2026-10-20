/** Preloaded by `bun test`, after `generate`, so a test's hook never waits on PGlite's initdb. */
import { buildMigratedSnapshot } from '../server/src/db/pglite-snapshot';

await buildMigratedSnapshot();
