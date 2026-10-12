import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { migrationsModule } from './migrations';

/**
 * Writes every generated file: the bundled migrations, the OpenAPI document, the web client's contract, and the
 * Swift API types. A file is rewritten only when its content changes, so watchers do not loop. `--check` writes
 * nothing and fails when a file is stale, which CI runs.
 */

const root = join(import.meta.dir, '../..');
const check = process.argv.includes('--check');

const outputs: [path: string, content: () => string][] = [
	['server/src/db/generated/migrations.ts', () => migrationsModule(join(root, 'server/drizzle'))],
];

const read = (path: string) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
};

const stale: string[] = [];
for (const [path, content] of outputs) {
	const file = join(root, path);
	const next = content();
	if (read(file) === next) continue;
	stale.push(relative(root, file));
	if (check) continue;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, next);
}

if (check && stale.length) {
	console.error(`Generated files are stale. Run \`bun run generate\` and commit:\n${stale.join('\n')}`);
	process.exit(1);
}
if (!check && stale.length) console.log(`generate: wrote ${stale.join(', ')}`);
