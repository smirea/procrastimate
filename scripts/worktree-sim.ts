/**
 * `./sim [n] [launcher args]`, the git-ignored wrapper setup-worktree.ts writes, calls this with the worktree's
 * simulator name. It builds and runs the app on that simulator, creating it on first use; `n` picks an extra one.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function json<T>(...args: string[]): T {
	const result = spawnSync('xcrun', ['simctl', 'list', ...args, '--json'], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`xcrun simctl list ${args.join(' ')} failed\n${result.stderr}`);
	return JSON.parse(result.stdout);
}

const [base, ...rest] = process.argv.slice(2);
if (!base) throw new Error('Usage: worktree-sim.ts <simulator name> [n] [launcher args]');
const extra = rest[0] && /^\d+$/.test(rest[0]) ? rest.shift() : undefined;
const name = extra ? `${base}-${extra}` : base;

type Device = { name: string; udid: string; state: string; dataPath: string };
function find(): Device | undefined {
	const { devices } = json<{ devices: Record<string, Device[]> }>('devices', 'available');
	return Object.values(devices)
		.flat()
		.find(device => device.name === name);
}

// A permission alert raised before the launcher started granting survives later grants and relaunches; only a reboot
// clears it. The launcher grants before every launch, so one reboot per simulator is enough. The marker lives in the
// simulator's data directory, so erasing the simulator resets it too.
const marker = (device: Device) => join(device.dataPath, 'procrastimate-permission-alerts-cleared');

let device = find();
if (device && !existsSync(marker(device)) && device.state === 'Booted') {
	console.log(`Rebooting ${name} to clear any permission alert left from before the launcher granted permissions.`);
	const shutdown = spawnSync('xcrun', ['simctl', 'shutdown', device.udid], { encoding: 'utf8' });
	if (shutdown.status !== 0) throw new Error(`Shutting down simulator ${name} failed\n${shutdown.stderr}`);
}

if (!device) {
	const { runtimes } = json<{ runtimes: { identifier: string; isAvailable: boolean }[] }>('runtimes');
	const runtime = runtimes.filter(r => r.isAvailable && r.identifier.includes('SimRuntime.iOS-27')).at(-1);
	if (!runtime) throw new Error('No iOS 27 simulator runtime. Add one in Xcode settings.');
	const created = spawnSync(
		'xcrun',
		['simctl', 'create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', runtime.identifier],
		{ encoding: 'utf8' },
	);
	if (created.status !== 0) throw new Error(`Creating simulator ${name} failed\n${created.stderr}`);
	console.log(`Created simulator ${name}.`);
	device = find();
	if (!device) throw new Error(`simctl created ${name} but does not list it.`);
}
mkdirSync(device.dataPath, { recursive: true });
writeFileSync(marker(device), '');

process.exit(spawnSync('bun', ['app-ios/scripts/run', '-t', device.udid, ...rest], { stdio: 'inherit' }).status ?? 1);
