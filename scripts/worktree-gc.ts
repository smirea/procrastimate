/**
 * Frees what agent worktrees leave behind: `bun scripts/worktree-gc.ts [--dry-run]`. Safe to run any time, from any
 * checkout; the orchestrator runs it on every wake.
 *   - deletes simulators claimed by a worktree that no longer exists
 *   - shuts down claimed simulators unused for 15 minutes that no running process names
 *   - deletes Xcode DerivedData of the App project at paths that no longer exist
 *   - lists worktrees whose PR merged, for teardown-worktree.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { devices, owner, remove, shutdown } from './simulators';

const dryRun = process.argv.includes('--dry-run');
const IDLE_MS = 15 * 60_000;

function run(cmd: string[]): string {
	const result = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8' });
	return result.status === 0 ? result.stdout.trim() : '';
}

function act(message: string, action: () => void) {
	console.log(`${dryRun ? '[dry run] ' : ''}${message}`);
	if (!dryRun) action();
}

const worktrees = run(['git', 'worktree', 'list', '--porcelain'])
	.split('\n\n')
	.map(block => ({
		path: block.match(/^worktree (.+)$/m)?.[1],
		branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1],
	}))
	.filter((entry): entry is { path: string; branch: string | undefined } => Boolean(entry.path));
const live = new Set(worktrees.map(entry => entry.path));
// A booted simulator's own processes carry its UDID in their paths, so only processes outside CoreSimulator count.
const processes = run(['ps', '-axww', '-o', 'command='])
	.split('\n')
	.filter(line => !line.includes('/CoreSimulator/'));
const inUse = (udid: string, name: string) =>
	processes.some(line => line.includes(udid) || line.includes(`worktree-sim.ts ${name}`));

for (const device of devices()) {
	const claim = owner(device);
	if (!claim) continue;
	if (!live.has(claim.worktree)) {
		act(`Deleting simulator ${device.name}; its worktree ${claim.worktree} is gone.`, () => remove(device));
	} else if (device.state === 'Booted' && Date.now() - claim.lastUsed > IDLE_MS && !inUse(device.udid, device.name)) {
		const minutes = Math.round((Date.now() - claim.lastUsed) / 60_000);
		act(`Shutting down ${device.name}, idle ${minutes} minutes.`, () => shutdown(device));
	}
}

const derivedData = join(homedir(), 'Library/Developer/Xcode/DerivedData');
for (const entry of existsSync(derivedData) ? readdirSync(derivedData) : []) {
	if (!entry.startsWith('App-')) continue;
	const workspace = run(['plutil', '-extract', 'WorkspacePath', 'raw', join(derivedData, entry, 'info.plist')]);
	if (!workspace || existsSync(workspace)) continue;
	act(`Deleting DerivedData ${entry} of the removed ${workspace}.`, () =>
		rmSync(join(derivedData, entry), { recursive: true, force: true }),
	);
}

for (const { path, branch } of worktrees.slice(1)) {
	if (!branch) continue;
	const state = run(['gh', 'pr', 'view', branch, '--json', 'state', '-q', '.state']);
	if (state === 'MERGED') console.log(`Merged, ready for teardown: bun scripts/teardown-worktree.ts ${path}`);
}
