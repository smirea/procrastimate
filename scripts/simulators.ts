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

const CPU_LIMIT = 70;
// Short enough that the wait plus an incremental build fits the 600-second tool limit.
const CPU_WAIT_MS = 3 * 60_000;

/** Total CPU use across all cores, in percent, from the second of two `top` samples (the first covers all uptime). */
export function cpuUsage(): number {
	const samples = [...run(['top', '-l', '2', '-n', '0', '-s', '1']).matchAll(/CPU usage:.*?([\d.]+)% idle/g)];
	const idle = samples.at(-1)?.[1];
	if (!idle) throw new Error('`top` printed no CPU usage line.');
	return Math.round(100 - Number(idle));
}

/**
 * Every booted simulator slows every other agent's build, so an agent boots one only while the Mac has room: total CPU at
 * or under 70%. It says it is waiting, and after three minutes exits 3, the code `pr-ship` uses for "rerun", so the
 * agent's tool call never hits the 600-second limit.
 */
export async function waitForCpu(what: string) {
	let usage = cpuUsage();
	if (usage <= CPU_LIMIT) return;
	const deadline = Date.now() + CPU_WAIT_MS;
	console.log(`CPU is at ${usage}% (limit ${CPU_LIMIT}%), so ${what} waits for the Mac to cool down…`);
	while (usage > CPU_LIMIT) {
		if (Date.now() > deadline) {
			console.log(`CPU is still at ${usage}% after 3 minutes. Rerun the same command to keep waiting.`);
			process.exit(3);
		}
		await Bun.sleep(20_000);
		usage = cpuUsage();
		console.log(`CPU at ${usage}%.`);
	}
}
