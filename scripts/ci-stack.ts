/**
 * The local Postgres and PowerSync for CI's end to end job: `bun scripts/ci-stack.ts`. Runs on the main checkout's
 * default ports, so PowerSync is on 6122 and the e2e API on 6126.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseUrl, ensureDatabases, ensurePostgres, requireDocker, startPowerSync } from './local-stack';
import { MAIN_PORT, OFFSET } from './ports.mts';

const root = join(import.meta.dir, '..');
const POWERSYNC_PORT = MAIN_PORT + OFFSET.powersync;
const database = 'ci';

requireDocker();
ensurePostgres();
await ensureDatabases(database, root);
await startPowerSync(root, database, POWERSYNC_PORT);
writeFileSync(
	join(root, '.env.override'),
	[`DATABASE_URL=${databaseUrl(database)}`, `POWERSYNC_URL=http://127.0.0.1:${POWERSYNC_PORT}`, ''].join('\n'),
);
console.log(`CI stack ready: database ${database}, PowerSync on ${POWERSYNC_PORT}`);
