/**
 * `wrangler dev` with the Worker's local stand-ins: `bun scripts/wrangler-dev.ts [wrangler dev args]`. The `App`
 * object keeps its SQLite under `.wrangler/state`, so it needs no service.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const passthrough = process.argv.slice(2);

if (!existsSync(join(root, '.dev.vars'))) {
	const written = spawnSync('bun', ['server/scripts/secrets.ts', 'dev-vars', '--generate-only'], {
		cwd: root,
		stdio: 'inherit',
	});
	if (written.status !== 0) process.exit(written.status ?? 1);
}

const result = spawnSync(
	'bunx',
	['wrangler', 'dev', '--var', 'AUTH_RATE_LIMIT:off', '--test-scheduled', ...passthrough],
	{
		cwd: root,
		stdio: 'inherit',
	},
);
process.exit(result.status ?? 1);
