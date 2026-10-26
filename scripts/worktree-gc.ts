/**
 * Frees what agent worktrees leave behind: `bun scripts/worktree-gc.ts [--dry-run]`. Safe to run any time, from any
 * checkout; the orchestrator runs it on every wake.
 *   - deletes simulators claimed by a worktree that no longer exists
 *   - shuts down claimed simulators unused for 15 minutes that no running process names
 *   - deletes Xcode DerivedData of the App project at paths that no longer exist
 *   - removes PowerSync containers and drops databases of worktrees that no longer exist
 *   - drops a live worktree's databases that none of its env files point at, left by a branch rename
 *   - drops inactive replication slots no live PowerSync container replicates, which would hold WAL forever
 *   - prints load, booted simulators, and worktree count
 *   - lists worktrees whose PR merged, for teardown-worktree.ts
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readOverride, run, worktrees } from './lib';
import {
	configuredDatabaseUrls,
	databaseOf,
	dockerRunning,
	dropDatabases,
	dropInactiveSlot,
	powerSyncContainers,
	removeContainer,
	replicationSlots,
	staleDatabases,
	worktreeDatabases,
} from './local-stack';
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
	const commented = Map.groupBy(await worktreeDatabases(), row => row.worktree);
	for (const [worktree, rows] of commented) {
		const databases = rows.map(row => row.database);
		const reason = live.has(worktree) ? 'none of its env files point at it' : 'its worktree is gone';
		for (const database of live.has(worktree)
			? staleDatabases(databases, configuredDatabaseUrls(worktree))
			: databases) {
			await act(`Dropping database ${database} of ${worktree}; ${reason}.`, () => dropDatabases(database));
		}
	}
	// A live worktree can still leave slots behind: its branch was renamed, so its old databases sit unreplicated, or
	// its container was removed by hand. PowerSync starts a new replication stream when it finds its slot missing.
	const replicated = new Set(
		powerSyncContainers()
			.filter(container => live.has(container.worktree))
			.flatMap(container => readOverride(container.worktree)?.DATABASE_URL ?? [])
			.map(databaseOf),
	);
	for (const slot of await replicationSlots()) {
		if (slot.active || replicated.has(slot.database)) continue;
		await act(
			`Dropping replication slot ${slot.name} of ${slot.database}, holding ${slot.held} of WAL; no PowerSync replicates it.`,
			async () => {
				if (!(await dropInactiveSlot(slot.name))) console.log(`Kept ${slot.name}; a PowerSync took it up meanwhile.`);
			},
		);
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
