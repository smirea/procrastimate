/**
 * Prepares a linked git worktree for an agent: `bun scripts/setup-worktree.ts [branch] [--reset-db]`.
 * `branch` renames the worktree's branch first, so the simulator, the PR, and teardown all share the final name.
 * `--reset-db` deletes the worktree's SQLite database in `.data/`. Safe to rerun. Never touches AWS.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';
import { readOverride, run as runCommand, worktrees } from './lib';

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

run(['bun', 'install', '--frozen-lockfile']);

const FIRST_BLOCK = 6200;
const LAST_BLOCK = 6980;

function readPort(worktree: string): number | undefined {
	const port = Number(readOverride(worktree)?.CLIENT_PORT);
	return port >= FIRST_BLOCK ? port : undefined;
}

function portFree(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const server = createServer()
			.once('error', () => resolve(false))
			.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
	});
}

// Each block holds web/api at +0/+1 and the e2e web/api at +10/+11 (playwright.config.ts derives its ports from
// CLIENT_PORT).
const OFFSETS = [0, 1, 10, 11];
async function pickBlock(): Promise<number> {
	const previous = readPort(root);
	if (previous) return previous;
	const claimed = new Set(worktrees(root).map(entry => readPort(entry.path)));
	for (let base = FIRST_BLOCK; base <= LAST_BLOCK; base += 20) {
		if (claimed.has(base)) continue;
		const free = await Promise.all(OFFSETS.map(offset => portFree(base + offset)));
		if (free.every(Boolean)) return base;
	}
	throw new Error(`No free port block between ${FIRST_BLOCK} and ${LAST_BLOCK}.`);
}

// A detached HEAD (mid-rebase) has no branch; the worktree directory is unique too, and teardown reads the name back from ./sim.
const branch = git('branch', '--show-current') || basename(root);

// Parallel setups would otherwise pick the same unclaimed block; mkdir is atomic, so it serves as the lock.
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
	base = await pickBlock();
	writeFileSync(
		join(root, '.env.override'),
		[`CLIENT_PORT=${base}`, `API_PORT=${base + 1}`, `API_URL=http://127.0.0.1:${base + 1}`, ''].join('\n'),
	);
} finally {
	rmSync(lock, { recursive: true, force: true });
}
const apiUrl = `http://127.0.0.1:${base + 1}`;

// Never `env-manager down`: the dev environment holds cloud credentials, and a worktree needs none.
run(['env-manager', 'gen', '--local']);
run(['bun', 'run', 'generate']);

// The Bun server creates and migrates its database on start (server/src/index.ts names the file).
const databaseFile = join(root, '.data', `${basename(root)}.sqlite`);
if (resetDb) for (const suffix of ['', '-wal', '-shm']) rmSync(`${databaseFile}${suffix}`, { force: true });

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
  database   ${databaseFile}${resetDb ? '  (reset)' : ''}
  e2e        ports ${base + 10}-${base + 11}, with a database of their own  (bun run test:e2e)
  ios        ./sim  (simulator "${simulator}", created on first run; ./sim 2 for a second one)`);
