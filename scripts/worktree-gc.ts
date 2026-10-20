/**
 * Frees what agent worktrees leave behind: `bun scripts/worktree-gc.ts [--dry-run]`. Safe to run any time, from any
 * checkout; the orchestrator runs it on every wake.
 *   - deletes simulators claimed by a worktree that no longer exists
 *   - shuts down claimed simulators unused for 15 minutes that no running process names
 *   - deletes Xcode DerivedData of the App project at paths that no longer exist
 *   - removes PowerSync containers and drops databases of worktrees that no longer exist
 *   - prints load, booted simulators, and worktree count
 *   - lists worktrees whose PR merged, for teardown-worktree.ts
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run, worktrees } from './lib';
import { dockerRunning, dropDatabases, powerSyncContainers, removeContainer, worktreeDatabases } from './local-stack';
import { devices, owner, remove, shutdown } from './simulators';

const dryRun = process.argv.includes('--dry-run');
const IDLE_MS = 15 * 60_000;

const tryRun = (cmd: string[]) => run(cmd, { allowFail: true });

async function act(message: string, action: () => unknown) {
	console.log(`${dryRun ? '[dry run] ' : ''}${message}`);
	if (!dryRun) await action();
}

const known = worktrees(import.meta.dir);
const live = new Set(known.map(entry => entry.path));
// A booted simulator's own processes carry its UDID in their paths, so only processes outside CoreSimulator count.
const processes = tryRun(['ps', '-axww', '-o', 'command='])
	.split('\n')
	.filter(line => !line.includes('/CoreSimulator/'));
const inUse = (udid: string, name: string) =>
	processes.some(line => line.includes(udid) || line.includes(`worktree-sim.ts ${name}`));

for (const device of devices()) {
	const claim = owner(device);
	if (!claim) continue;
	if (!live.has(claim.worktree)) {
		await act(`Deleting simulator ${device.name}; its worktree ${claim.worktree} is gone.`, () => remove(device));
	} else if (device.state === 'Booted' && Date.now() - claim.lastUsed > IDLE_MS && !inUse(device.udid, device.name)) {
		const minutes = Math.round((Date.now() - claim.lastUsed) / 60_000);
		await act(`Shutting down ${device.name}, idle ${minutes} minutes.`, () => shutdown(device));
	}
}

const derivedData = join(homedir(), 'Library/Developer/Xcode/DerivedData');
for (const entry of existsSync(derivedData) ? readdirSync(derivedData) : []) {
	if (!entry.startsWith('App-')) continue;
	const workspace = tryRun(['plutil', '-extract', 'WorkspacePath', 'raw', join(derivedData, entry, 'info.plist')]);
	if (!workspace || existsSync(workspace)) continue;
	await act(`Deleting DerivedData ${entry} of the removed ${workspace}.`, () =>
		rmSync(join(derivedData, entry), { recursive: true, force: true }),
	);
}

if (dockerRunning()) {
	for (const container of powerSyncContainers()) {
		if (live.has(container.worktree)) continue;
		await act(`Removing ${container.name}; its worktree ${container.worktree} is gone.`, () =>
			removeContainer(container.name),
		);
	}
	for (const { database, worktree } of await worktreeDatabases()) {
		if (live.has(worktree)) continue;
		await act(`Dropping database ${database}; its worktree ${worktree} is gone.`, () => dropDatabases(database));
	}
}

const booted = devices()
	.filter(device => device.state === 'Booted')
	.map(device => device.name);
console.log(
	`Load ${tryRun(['sysctl', '-n', 'vm.loadavg']).replaceAll(/[{}]/g, '').trim()} on ${navigator.hardwareConcurrency} cores; ${booted.length} booted simulators${booted.length ? ` (${booted.join(', ')})` : ''}; ${known.length - 1} worktrees.`,
);

for (const { path, branch } of known.slice(1)) {
	if (!branch) continue;
	const state = tryRun(['gh', 'pr', 'view', branch, '--json', 'state', '-q', '.state']);
	if (state === 'MERGED') console.log(`Merged, ready for teardown: bun scripts/teardown-worktree.ts ${path}`);
}
