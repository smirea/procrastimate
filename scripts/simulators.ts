/**
 * The iOS simulators agent worktrees own. `./sim` claims a simulator by writing its worktree's path into the
 * simulator's data directory and rewrites it on every command, so the file's mtime is the simulator's last use.
 * teardown-worktree.ts and worktree-gc.ts read the claim back.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './lib';

export type Device = { name: string; udid: string; state: string; dataPath: string };

export const simctl = (...args: string[]) => run(['xcrun', 'simctl', ...args]);

export function devices(): Device[] {
	const { devices } = JSON.parse(simctl('list', 'devices', '--json')) as { devices: Record<string, Device[]> };
	return Object.values(devices).flat();
}

const claimFile = (device: Device) => join(device.dataPath, 'procrastimate-worktree');

export function claim(device: Device, worktree: string) {
	mkdirSync(device.dataPath, { recursive: true });
	writeFileSync(claimFile(device), worktree);
}

export function owner(device: Device): { worktree: string; lastUsed: number } | undefined {
	const file = claimFile(device);
	if (!existsSync(file)) return undefined;
	return { worktree: readFileSync(file, 'utf8').trim(), lastUsed: statSync(file).mtimeMs };
}

export function shutdown(device: Device) {
	if (device.state !== 'Shutdown') spawnSync('xcrun', ['simctl', 'shutdown', device.udid]);
}

export function remove(device: Device) {
	shutdown(device);
	simctl('delete', device.udid);
}
