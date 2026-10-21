/**
 * The local Postgres and PowerSync for CI's end to end job: `bun scripts/ci-stack.ts`. Runs on the main checkout's
 * default ports, so PowerSync is on 6122 and the e2e API on 6131.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseUrl, ensureDatabases, ensurePostgres, requireDocker, startPowerSync } from './local-stack';

const root = join(import.meta.dir, '..');
const CLIENT_PORT = 6120;
const database = 'ci';

requireDocker();
ensurePostgres();
await ensureDatabases(database, root);
await startPowerSync(root, database, CLIENT_PORT + 2);
writeFileSync(
	join(root, '.env.override'),
	[`DATABASE_URL=${databaseUrl(database)}`, `POWERSYNC_URL=http://127.0.0.1:${CLIENT_PORT + 2}`, ''].join('\n'),
);
console.log(`CI stack ready: database ${database}, PowerSync on ${CLIENT_PORT + 2}`);
