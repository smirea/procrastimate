/**
 * `wrangler dev` against this worktree's local stack: `bun scripts/wrangler-dev.ts [--e2e] [wrangler dev args]`.
 * Reads `.env.override`, points the Hyperdrive binding at the worktree's database through the environment variable
 * wrangler honors, passes its PowerSync as a var, turns the sign-in rate limit off, and makes sure `.dev.vars` exists.
 * `--e2e` uses the e2e database and PowerSync instead of the dev ones.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readOverride } from './local-stack';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const e2e = args.includes('--e2e');
const passthrough = args.filter(arg => arg !== '--e2e');

const override = readOverride(root);
if (!override) throw new Error('No .env.override. Run `bun scripts/setup-worktree.ts` first.');
const database = e2e ? override.E2E_DATABASE_URL : override.DATABASE_URL;
const powersync = e2e ? override.E2E_POWERSYNC_URL : override.POWERSYNC_URL;
if (!database || !powersync)
	throw new Error('.env.override lacks the database or PowerSync URL. Rerun setup-worktree.');

if (!existsSync(join(root, '.dev.vars'))) {
	const written = spawnSync('bun', ['server/scripts/secrets.ts', 'dev-vars', '--generate-only'], {
		cwd: root,
		stdio: 'inherit',
	});
	if (written.status !== 0) process.exit(written.status ?? 1);
}

const result = spawnSync(
	'bunx',
	['wrangler', 'dev', '--var', `POWERSYNC_URL:${powersync}`, '--var', 'AUTH_RATE_LIMIT:off', ...passthrough],
	{
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database },
	},
);
process.exit(result.status ?? 1);
