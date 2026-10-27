/**
 * Removes an agent's worktree once its PR is merged: `bun scripts/teardown-worktree.ts <worktree path | branch> [--force]`.
 * A worktree on a detached HEAD has no branch: pass its path or directory name with --force instead.
 * Run it from the main checkout. Stops its servers, deletes its simulators, worktree (its SQLite database with it), and
 * branches, and updates master.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readOverride, run, worktrees } from './lib';
import { OFFSET, worktreeOf } from './ports.mts';
import { devices, owner, remove } from './simulators';

const args = process.argv.slice(2);
const force = args.includes('--force');
const target = args.find(arg => !arg.startsWith('-'));
if (!target) throw new Error('Usage: bun scripts/teardown-worktree.ts <worktree path | branch> [--force]');

const root = run(['git', 'rev-parse', '--show-toplevel']);
if (run(['git', 'rev-parse', '--git-dir']) !== run(['git', 'rev-parse', '--git-common-dir'])) {
	throw new Error('Run this from the main checkout, not from a worktree.');
}

const known = worktrees(root);
const entry =
	known.find(entry => entry.path === resolve(target)) ??
	known.find(entry => entry.branch === target) ??
	known.find(entry => basename(entry.path) === target);
const worktree = entry?.path;
const branch = entry ? entry.branch : target;
const detached = Boolean(entry && !entry.branch);

const pr = branch
	? run(['gh', 'pr', 'view', branch, '--json', 'state,url', '-q', '.state + " " + .url'], { allowFail: true })
	: '';
if (!pr.startsWith('MERGED') && !force) {
	throw new Error(`The PR for ${branch ?? target} is ${pr || 'missing'}. Pass --force to tear it down anyway.`);
}

if (worktree) {
	const base = Number(readOverride(worktree)?.CLIENT_PORT) || undefined;
	if (base) {
		// Worktrees from before the per-app scheme (6200 to 6980) ran their e2e servers at +10 and +11.
		const offsets = worktreeOf(base)
			? [OFFSET.web, OFFSET.api, OFFSET.e2eWeb, OFFSET.e2eApi]
			: [OFFSET.web, OFFSET.api, 10, 11];
		const ports = offsets.map(offset => `-iTCP:${base + offset}`);
		const pids = run(['lsof', '-t', '-sTCP:LISTEN', ...ports], { allowFail: true })
			.split('\n')
			.filter(Boolean);
		if (pids.length) run(['kill', ...new Set(pids)], { allowFail: true });
	}

	const sim = join(worktree, 'sim');
	const name = existsSync(sim) ? readFileSync(sim, 'utf8').match(/worktree-sim\.ts '([^']+)'/)?.[1] : undefined;
	for (const device of devices()) {
		const named = name && (device.name === name || new RegExp(`^${RegExp.escape(name)}-\\d+$`).test(device.name));
		if (!named && owner(device)?.worktree !== worktree) continue;
		remove(device);
		console.log(`Deleted simulator ${device.name}.`);
	}

	run(['git', 'worktree', 'remove', '--force', worktree]);
	console.log(`Removed worktree ${worktree}.`);
}

if (branch && !detached) {
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
	`Tore down ${worktree ?? branch}${pr ? ` (${pr})` : ''}. ${root} master is at ${run(['git', 'rev-parse', '--short', 'master'])}.`,
);
