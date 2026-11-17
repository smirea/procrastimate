/**
 * Fails when `shared/vectors` differs from what `bun run vectors` records now: a changed or missing file, or one no
 * test records anymore. It records into a temporary directory, so the pre-commit hook can run it beside the other jobs
 * without rewriting files they read.
 */
import { $ } from 'bun';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const committed = join(import.meta.dir, '../shared/vectors');
const fresh = mkdtempSync(join(tmpdir(), 'vectors-'));

async function staleFiles(): Promise<string[]> {
	const result = await $`bun run vectors`
		.cwd(join(import.meta.dir, '..'))
		.env({ ...process.env, VECTORS_DIR: fresh })
		.quiet()
		.nothrow();
	if (result.exitCode !== 0) {
		process.stderr.write(result.stderr);
		throw new Error('bun run vectors failed');
	}
	const recorded = readdirSync(fresh);
	return [
		...recorded.filter(name => {
			const path = join(committed, name);
			return !existsSync(path) || readFileSync(path, 'utf8') !== readFileSync(join(fresh, name), 'utf8');
		}),
		...readdirSync(committed).filter(name => name.endsWith('.json') && !recorded.includes(name)),
	];
}

try {
	const stale = await staleFiles();
	if (stale.length) {
		console.error(`shared/vectors is stale: ${stale.join(', ')}. Run 'bun run vectors' and commit the result.`);
		process.exitCode = 1;
	}
} finally {
	rmSync(fresh, { recursive: true, force: true });
}
