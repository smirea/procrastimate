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
 * one. `scripts/pglite-snapshot.ts`, preloaded by `bun test`, builds it before any test's time limit starts. The same
 * run saves the database as initdb left it, before any migration, for the tests of `migrate` itself.
 */

const dir = join(import.meta.dir, 'generated');
const pgliteVersion: string = JSON.parse(
	readFileSync(join(dirname(Bun.resolveSync('@electric-sql/pglite', import.meta.dir)), '../package.json'), 'utf8'),
).version;
const name = `pglite-${Bun.hash(JSON.stringify([pgliteVersion, migrations])).toString(36)}.tar.gz`;
const path = join(dir, name);
const emptyName = `pglite-empty-${Bun.hash(pgliteVersion).toString(36)}.tar.gz`;
const emptyPath = join(dir, emptyName);

/** Parallel `bun test` runs in one worktree each write their own file and rename it into place. */
async function save(client: PGlite, to: string) {
	const partial = `${to}.${process.pid}`;
	await Bun.write(partial, await client.dumpDataDir('gzip'));
	renameSync(partial, to);
}

export async function buildMigratedSnapshot(): Promise<void> {
	if (existsSync(path) && existsSync(emptyPath)) return;
	const client = new PGlite();
	// A dump before initdb finishes never resolves.
	await client.waitReady;
	await save(client, emptyPath);
	await migrate(drizzle(client));
	await save(client, path);
	await client.close();
	for (const file of readdirSync(dir)) {
		if (file.startsWith('pglite-') && !file.startsWith(name) && !file.startsWith(emptyName))
			unlinkSync(join(dir, file));
	}
}

function snapshot(at: string): Blob {
	if (!existsSync(at))
		throw new Error(`No PGlite snapshot at ${at}. Run tests with \`bun test\`, whose preload builds it.`);
	return Bun.file(at);
}

export const migratedSnapshot = () => snapshot(path);
export const emptySnapshot = () => snapshot(emptyPath);
