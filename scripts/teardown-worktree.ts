/**
 * Removes an agent's worktree once its PR is merged: `bun scripts/teardown-worktree.ts <branch> [--force]`.
 * A worktree on a detached HEAD has no branch: pass its directory name with --force instead.
 * Run it from the main checkout. Stops its servers, deletes its simulators, worktree, and branches, and updates master.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function run(cmd: string[], opts: { allowFail?: boolean } = {}): string {
	const result = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8' });
	if (result.status !== 0 && !opts.allowFail)
		throw new Error(`\`${cmd.join(' ')}\` failed\n${result.stderr}${result.stdout}`);
	return result.stdout.trim();
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const branch = args.find(arg => !arg.startsWith('-'));
if (!branch) throw new Error('Usage: bun scripts/teardown-worktree.ts <branch | worktree directory name> [--force]');

const root = run(['git', 'rev-parse', '--show-toplevel']);
if (run(['git', 'rev-parse', '--git-dir']) !== run(['git', 'rev-parse', '--git-common-dir'])) {
	throw new Error('Run this from the main checkout, not from a worktree.');
}

const pr = run(['gh', 'pr', 'view', branch, '--json', 'state,url', '-q', '.state + " " + .url'], { allowFail: true });
if (!pr.startsWith('MERGED') && !force) {
	throw new Error(`The PR for ${branch} is ${pr || 'missing'}. Pass --force to tear it down anyway.`);
}

const worktrees = run(['git', 'worktree', 'list', '--porcelain'])
	.split('\n\n')
	.map(block => ({
		path: block.match(/^worktree (.+)$/m)?.[1],
		branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1],
	}));
const onBranch = worktrees.find(entry => entry.branch === branch)?.path;
const detached = onBranch
	? undefined
	: worktrees.find(entry => !entry.branch && entry.path && basename(entry.path) === branch)?.path;
const worktree = onBranch ?? detached;

if (worktree) {
	const override = join(worktree, '.env.override');
	const base = existsSync(override)
		? Number(readFileSync(override, 'utf8').match(/^CLIENT_PORT=(\d+)/m)?.[1])
		: undefined;
	if (base) {
		const ports = [base, base + 1, base + 10, base + 11].map(port => `-iTCP:${port}`);
		const pids = run(['lsof', '-t', '-sTCP:LISTEN', ...ports], { allowFail: true })
			.split('\n')
			.filter(Boolean);
		if (pids.length) run(['kill', ...new Set(pids)], { allowFail: true });
	}

	const sim = join(worktree, 'sim');
	const name = existsSync(sim) ? readFileSync(sim, 'utf8').match(/worktree-sim\.ts '([^']+)'/)?.[1] : undefined;
	if (name) {
		const { devices } = JSON.parse(run(['xcrun', 'simctl', 'list', 'devices', '--json'])) as {
			devices: Record<string, { name: string; udid: string }[]>;
		};
		for (const device of Object.values(devices).flat()) {
			if (device.name !== name && !new RegExp(`^${RegExp.escape(name)}-\\d+$`).test(device.name)) continue;
			run(['xcrun', 'simctl', 'shutdown', device.udid], { allowFail: true });
			run(['xcrun', 'simctl', 'delete', device.udid]);
			console.log(`Deleted simulator ${device.name}.`);
		}
	}

	run(['git', 'worktree', 'remove', '--force', worktree]);
	console.log(`Removed worktree ${worktree}.`);
}

if (!detached) {
	run(['git', 'branch', '-D', branch], { allowFail: true });
	run(['git', 'push', 'origin', '--delete', branch], { allowFail: true });
}
run(['git', 'worktree', 'prune']);

if (run(['git', 'branch', '--show-current']) === 'master') {
	run(['git', 'pull', '--ff-only', 'origin', 'master'], { allowFail: true });
} else {
	run(['git', 'fetch', 'origin', 'master:master'], { allowFail: true });
}
console.log(
	`Tore down ${branch}${pr ? ` (${pr})` : ''}. ${root} master is at ${run(['git', 'rev-parse', '--short', 'master'])}.`,
);
