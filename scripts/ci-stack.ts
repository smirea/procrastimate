/**
 * The local Postgres and PowerSync for CI's end to end job: `bun scripts/ci-stack.ts`. The same containers a
 * worktree runs, through the same module, on the main checkout's default ports (CLIENT_PORT 6120, so the e2e API
 * is 6131 and its PowerSync 6132). Writes `.env.override` with the e2e database and PowerSync URLs, then
 * `env-manager gen --local` carries them into `app-web/.env.local` for Playwright.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseUrl, ensureDatabases, ensurePostgres, requireDocker, startPowerSync } from './local-stack';

const root = join(import.meta.dir, '..');
const CLIENT_PORT = 6120;
const database = 'ci';

requireDocker();
ensurePostgres();
await ensureDatabases(database, 'e2e', root);
await startPowerSync(root, database, 'e2e', CLIENT_PORT + 12);
writeFileSync(
	join(root, '.env.override'),
	[
		`E2E_DATABASE_URL=${databaseUrl(`${database}_e2e`)}`,
		`E2E_POWERSYNC_URL=http://127.0.0.1:${CLIENT_PORT + 12}`,
		'',
	].join('\n'),
);
const generated = spawnSync('env-manager', ['gen', '--local'], { cwd: root, stdio: 'inherit' });
if (generated.status !== 0) process.exit(generated.status ?? 1);
console.log(`CI stack ready: database ${database}_e2e, PowerSync on ${CLIENT_PORT + 12}`);
