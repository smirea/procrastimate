import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrations } from './generated/migrations';
import { migrate } from './migrate';

/**
 * Every test database loads one migrated PGlite data directory saved in `generated/`. A fresh `new PGlite()` runs
 * initdb, which took 3 to 7 s with ten agent worktrees loading the Mac, past the 5 s hook limit; loading the saved
 * one takes 0.1 to 0.6 s. The name hashes the migrations and the PGlite version, so a change to either builds a new
 * one. `scripts/pglite-snapshot.ts`, preloaded by `bun test`, builds it before any test's time limit starts.
 */

const dir = join(import.meta.dir, 'generated');
const pgliteVersion: string = JSON.parse(
	readFileSync(join(dirname(Bun.resolveSync('@electric-sql/pglite', import.meta.dir)), '../package.json'), 'utf8'),
).version;
const name = `pglite-${Bun.hash(JSON.stringify([pgliteVersion, migrations])).toString(36)}.tar.gz`;
const path = join(dir, name);

export async function buildMigratedSnapshot(): Promise<void> {
	if (existsSync(path)) return;
	const client = new PGlite();
	await migrate(drizzle(client));
	// Parallel `bun test` runs in one worktree each write their own file and rename it into place.
	const partial = `${path}.${process.pid}`;
	await Bun.write(partial, await client.dumpDataDir('gzip'));
	await client.close();
	renameSync(partial, path);
	for (const file of readdirSync(dir)) {
		if (file.startsWith('pglite-') && !file.startsWith(name)) unlinkSync(join(dir, file));
	}
}

export function migratedSnapshot(): Blob {
	if (!existsSync(path))
		throw new Error(`No PGlite snapshot at ${path}. Run tests with \`bun test\`, whose preload builds it.`);
	return Bun.file(path);
}
