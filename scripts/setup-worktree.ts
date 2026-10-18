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
	databaseUrl,
	ensureDatabases,
	ensurePostgres,
	requireDocker,
	startPowerSync,
} from './local-stack';

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

const args = process.argv.slice(2);
const resetDb = args.includes('--reset-db');
const wanted = args.find(arg => !arg.startsWith('--'));
if (wanted && wanted !== git('branch', '--show-current')) {
	if (git('branch', '--show-current')) git('branch', '-m', wanted);
	else git('switch', '-c', wanted);
}

// Before anything slow, so a Mac without Docker fails in a second with the fix named.
requireDocker();

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

// Each block holds dev web/api/powersync at +0/+1/+2 and e2e web/api/powersync at +10/+11/+12 (playwright.config.ts
// derives its ports from CLIENT_PORT and its database and PowerSync from E2E_DATABASE_URL and E2E_POWERSYNC_URL).
const OFFSETS = [0, 1, 2, 10, 11, 12];
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
		const free = await Promise.all(OFFSETS.map(offset => portFree(base + offset)));
		if (free.every(Boolean)) return base;
	}
	throw new Error(`No free port block between ${FIRST_BLOCK} and ${LAST_BLOCK}.`);
}

// A detached HEAD (mid-rebase) has no branch; the worktree directory is unique too, and teardown reads the name back from ./sim.
const branch = git('branch', '--show-current') || basename(root);
const database = databaseName(branch);

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
		[
			`CLIENT_PORT=${base}`,
			`API_PORT=${base + 1}`,
			`API_URL=http://127.0.0.1:${base + 1}`,
			`DATABASE_URL=${databaseUrl(database)}`,
			`POWERSYNC_URL=http://127.0.0.1:${base + 2}`,
			`E2E_DATABASE_URL=${databaseUrl(`${database}_e2e`)}`,
			`E2E_POWERSYNC_URL=http://127.0.0.1:${base + 12}`,
			'',
		].join('\n'),
	);
} finally {
	rmSync(lock, { recursive: true, force: true });
}
const apiUrl = `http://127.0.0.1:${base + 1}`;

// Never `env-manager down`: the dev environment holds cloud credentials, and a worktree runs on Docker alone.
run(['env-manager', 'gen', '--local']);

const serverEnv = readFileSync(join(root, 'server/.env.local'), 'utf8');
const serverDatabase = serverEnv.match(/^DATABASE_URL='?([^'\s#]+)/m)?.[1];
if (!serverDatabase || !/^postgres:\/\/[^@]*@(127\.0\.0\.1|localhost):/.test(serverDatabase)) {
	throw new Error(`server/.env.local must point DATABASE_URL at the local Docker Postgres, not ${serverDatabase}.`);
}

ensurePostgres();
await ensureDatabases(database, 'dev', root, resetDb);
await ensureDatabases(database, 'e2e', root, resetDb);
await Promise.all([startPowerSync(root, database, 'dev', base + 2), startPowerSync(root, database, 'e2e', base + 12)]);

run(['bun', 'run', 'generate']);

// Restricted to shell-safe characters because ./sim embeds it in single quotes.
const simulator = branch.replaceAll(/[^\w.-]/g, '-');
const sim = join(root, 'sim');
writeFileSync(sim, `#!/bin/sh\ncd "$(dirname "$0")" && exec bun scripts/worktree-sim.ts '${simulator}' "$@"\n`);
chmodSync(sim, 0o755);

console.log(`
Worktree ready on ${branch}.
  web        http://127.0.0.1:${base}  (bun run start)
  api        ${apiUrl}
  powersync  http://127.0.0.1:${base + 2}  (container procrastimate-powersync-${basename(root)})
  database   ${databaseUrl(database)}${resetDb ? '  (reset)' : ''}
  e2e        ports ${base + 10}-${base + 12}, database ${database}_e2e  (bun run test:e2e)
  ios        ./sim  (simulator "${simulator}", created on first run; ./sim 2 for a second one)`);
