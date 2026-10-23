/**
 * Prepares a linked git worktree for an agent: `bun scripts/setup-worktree.ts [branch] [--reset-db]`.
 * `branch` renames the worktree's branch first, so the simulator, the database, the PR, and teardown all share the
 * final name. `--reset-db` drops and recreates the worktree's databases. Safe to rerun. Never touches AWS.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';
import {
	databaseName,
	databaseOf,
	databaseUrl,
	ensureDatabases,
	ensurePostgres,
	requireDocker,
	startPowerSync,
	stopPowerSync,
} from './local-stack';
import { parseDotenv, readOverride, run as runCommand, worktrees } from './lib';
import { MAX_WORKTREE, OFFSET, worktreeOf, worktreePort } from './ports.mts';

const run = (cmd: string[]) => runCommand(cmd, { stdio: 'inherit-stderr' });
const git = (...args: string[]) => runCommand(['git', ...args]);

const root = git('rev-parse', '--show-toplevel');
process.chdir(root);
if (git('rev-parse', '--git-dir') === git('rev-parse', '--git-common-dir')) {
	throw new Error('This is the main checkout. Run this inside a linked worktree.');
}

const args = process.argv.slice(2);
const resetDb = args.includes('--reset-db');
const wanted = args.find(arg => !arg.startsWith('--'));
if (wanted && wanted !== git('branch', '--show-current')) {
	if (git('branch', '--show-current')) git('branch', '-m', wanted);
	else git('switch', '-c', wanted);
}

// Before anything slow, so a Mac without Docker fails in a second with the fix named.
requireDocker();

// Bun's resolver remembers that node_modules was missing at startup, so the dynamic imports of `postgres` and the
// server's database code failed with "Cannot find package" in a new worktree. A fresh process after the install sees it.
const installed = existsSync(join(root, 'node_modules'));
run(['bun', 'install', '--frozen-lockfile']);
if (!installed) process.exit(spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' }).status ?? 1);

function worktreeNumber(worktree: string): number | undefined {
	return worktreeOf(Number(readOverride(worktree)?.CLIENT_PORT));
}

function portFree(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const server = createServer()
			.once('error', () => resolve(false))
			.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
	});
}

// A worktree set up under an older scheme has no number yet, so a rerun moves it into the current one.
async function pickWorktreeNumber(): Promise<number> {
	const previous = worktreeNumber(root);
	if (previous) return previous;
	const claimed = new Set(worktrees(root).map(entry => worktreeNumber(entry.path)));
	for (let n = 1; n <= MAX_WORKTREE; n++) {
		if (claimed.has(n)) continue;
		const free = await Promise.all(Object.values(OFFSET).map(offset => portFree(worktreePort(n) + offset)));
		if (free.every(Boolean)) return n;
	}
	throw new Error(
		`All ${MAX_WORKTREE} worktree port blocks (${worktreePort(1)} to ${worktreePort(MAX_WORKTREE) + 9}) are claimed or busy. Tear down merged worktrees first: bun scripts/worktree-gc.ts lists them.`,
	);
}

// A detached HEAD (mid-rebase) has no branch; the worktree directory is unique too, and teardown reads the name back from ./sim.
const branch = git('branch', '--show-current') || basename(root);
// A rerun keeps the names the first run recorded: T3 renames a thread's branch seconds after setup starts, and naming
// them from the new branch would hand the worktree an empty database and orphan the old one and its simulator.
const recordedDatabase = readOverride(root)?.DATABASE_URL;
const database = recordedDatabase ? databaseOf(recordedDatabase) : databaseName(branch);

// Parallel setups would otherwise pick the same unclaimed number; mkdir is atomic, so it serves as the lock.
const lock = join(git('rev-parse', '--git-common-dir'), 'setup-worktree.lock');
for (const started = Date.now(); ; await Bun.sleep(100)) {
	try {
		mkdirSync(lock);
		break;
	} catch {
		const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
		if (age > 60_000) rmSync(lock, { recursive: true, force: true });
		if (Date.now() - started > 120_000) throw new Error(`Timed out waiting for ${lock}.`);
	}
}
let base: number;
try {
	base = worktreePort(await pickWorktreeNumber());
	writeFileSync(
		join(root, '.env.override'),
		[
			`CLIENT_PORT=${base}`,
			`API_PORT=${base + OFFSET.api}`,
			`API_URL=http://127.0.0.1:${base + OFFSET.api}`,
			`DATABASE_URL=${databaseUrl(database)}`,
			`POWERSYNC_URL=http://127.0.0.1:${base + OFFSET.powersync}`,
			'',
		].join('\n'),
	);
} finally {
	rmSync(lock, { recursive: true, force: true });
}
const apiUrl = `http://127.0.0.1:${base + OFFSET.api}`;

// Never `env-manager down`: the dev environment holds cloud credentials, and a worktree runs on Docker alone.
run(['env-manager', 'gen', '--local']);

const serverDatabase = parseDotenv(readFileSync(join(root, 'server/.env.local'), 'utf8')).DATABASE_URL;
if (!serverDatabase || !/^postgres:\/\/[^@]*@(127\.0\.0\.1|localhost):/.test(serverDatabase)) {
	throw new Error(`server/.env.local must point DATABASE_URL at the local Docker Postgres, not ${serverDatabase}.`);
}

// The stack migrates with the bundled migrations, which generate writes.
run(['bun', 'run', 'generate']);

ensurePostgres();
// PowerSync holds its slot open, and a reset drops the databases it replicates.
if (resetDb) stopPowerSync(root);
await ensureDatabases(database, root, resetDb);
await startPowerSync(root, database, base + OFFSET.powersync);

const sim = join(root, 'sim');
// Restricted to shell-safe characters because ./sim embeds it in single quotes.
const simulator =
	(existsSync(sim) && readFileSync(sim, 'utf8').match(/worktree-sim\.ts '([^']+)'/)?.[1]) ||
	branch.replaceAll(/[^\w.-]/g, '-');
writeFileSync(sim, `#!/bin/sh\ncd "$(dirname "$0")" && exec bun scripts/worktree-sim.ts '${simulator}' "$@"\n`);
chmodSync(sim, 0o755);

console.log(`
Worktree ready on ${branch}.
  web        http://127.0.0.1:${base}  (bun run start)
  api        ${apiUrl}
  powersync  http://127.0.0.1:${base + OFFSET.powersync}  (container procrastimate-powersync-${basename(root)})
  database   ${databaseUrl(database)}${resetDb ? '  (reset)' : ''}
  e2e        ports ${base + OFFSET.e2eWeb}-${base + OFFSET.e2eApi}, same database and PowerSync  (bun run test:e2e)
  ios        ./sim  (simulator "${simulator}", created on first run; ./sim 2 for a second one)`);
