/** `wrangler dev` against this worktree's local stack: `bun scripts/wrangler-dev.ts [wrangler dev args]`. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readOverride } from './local-stack';

const root = join(import.meta.dir, '..');
const passthrough = process.argv.slice(2);

const override = readOverride(root);
if (!override) throw new Error('No .env.override. Run `bun scripts/setup-worktree.ts` first.');
const database = override.DATABASE_URL;
const powersync = override.POWERSYNC_URL;
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
