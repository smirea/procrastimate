/**
 * Prepares a linked git worktree for an agent: `bun scripts/setup-worktree.ts`.
 * Safe to rerun. Never touches AWS or the shared dev database.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';

function run(cmd: string[], opts: { quiet?: boolean } = {}): string {
	const result = spawnSync(cmd[0]!, cmd.slice(1), {
		encoding: 'utf8',
		stdio: opts.quiet ? 'pipe' : ['ignore', 'pipe', 'inherit'],
	});
	if (result.status !== 0) throw new Error(`\`${cmd.join(' ')}\` failed\n${result.stderr ?? ''}${result.stdout ?? ''}`);
	return result.stdout.trim();
}

function git(...args: string[]): string {
	return run(['git', ...args], { quiet: true });
}

const root = git('rev-parse', '--show-toplevel');
process.chdir(root);
if (git('rev-parse', '--git-dir') === git('rev-parse', '--git-common-dir')) {
	throw new Error('This is the main checkout. Run this inside a linked worktree.');
}

run(['bun', 'install', '--frozen-lockfile']);

const FIRST_BLOCK = 6200;
const LAST_BLOCK = 6980;

function readPort(worktree: string): number | undefined {
	const file = join(worktree, '.env.override');
	if (!existsSync(file)) return undefined;
	const port = Number(readFileSync(file, 'utf8').match(/^CLIENT_PORT=(\d+)/m)?.[1]);
	return port >= FIRST_BLOCK ? port : undefined;
}

function portFree(port: number): Promise<boolean> {
	return new Promise(resolve => {
		const server = createServer()
			.once('error', () => resolve(false))
			.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
	});
}

// Each block holds dev web/api at +0/+1 and e2e web/api at +10/+11 (playwright.config.ts derives those from CLIENT_PORT).
async function pickBlock(): Promise<number> {
	const previous = readPort(root);
	if (previous) return previous;
	const claimed = new Set(
		git('worktree', 'list', '--porcelain')
			.split('\n')
			.filter(line => line.startsWith('worktree '))
			.map(line => readPort(line.slice('worktree '.length))),
	);
	for (let base = FIRST_BLOCK; base <= LAST_BLOCK; base += 20) {
		if (claimed.has(base)) continue;
		const free = await Promise.all([0, 1, 10, 11].map(offset => portFree(base + offset)));
		if (free.every(Boolean)) return base;
	}
	throw new Error(`No free port block between ${FIRST_BLOCK} and ${LAST_BLOCK}.`);
}

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
		`CLIENT_PORT=${base}\nAPI_PORT=${base + 1}\nAPI_URL=http://127.0.0.1:${base + 1}\n`,
	);
} finally {
	rmSync(lock, { recursive: true, force: true });
}
const apiUrl = `http://127.0.0.1:${base + 1}`;

// Never `env-manager down`: dev points at the shared Turso database.
run(['env-manager', 'gen', '--local']);

const serverEnv = readFileSync(join(root, 'server/.env.local'), 'utf8');
if (/^TURSO_DATABASE_URL='?[^'\s#]/m.test(serverEnv)) {
	throw new Error('server/.env.local points at a Turso database. Worktrees must use the in-memory database.');
}

run(['bun', 'run', 'generate']);

// A detached HEAD (mid-rebase) has no branch; the worktree directory is unique too, and teardown reads the name back from ./sim.
const branch = git('branch', '--show-current') || basename(root);
// Restricted to shell-safe characters because ./sim embeds it in single quotes.
const simulator = branch.replaceAll(/[^\w.-]/g, '-');
const sim = join(root, 'sim');
writeFileSync(sim, `#!/bin/sh\ncd "$(dirname "$0")" && exec bun scripts/worktree-sim.ts '${simulator}' "$@"\n`);
chmodSync(sim, 0o755);

console.log(`
Worktree ready on ${branch}.
  web     http://127.0.0.1:${base}  (bun run start)
  api     ${apiUrl}
  e2e     ports ${base + 10}-${base + 11}  (bun run test:e2e)
  db      in-memory
  ios     ./sim  (simulator "${simulator}", created on first run; ./sim 2 for a second one)`);
