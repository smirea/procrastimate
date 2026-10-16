/**
 * `./sim [n] [launcher args]`, the git-ignored wrapper setup-worktree.ts writes, calls this with the worktree's
 * simulator name. It builds and runs the app on that simulator, creating it on first use; `n` picks an extra one.
 */
import { spawnSync } from 'node:child_process';

function json<T>(...args: string[]): T {
	const result = spawnSync('xcrun', ['simctl', 'list', ...args, '--json'], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`xcrun simctl list ${args.join(' ')} failed\n${result.stderr}`);
	return JSON.parse(result.stdout);
}

const [base, ...rest] = process.argv.slice(2);
if (!base) throw new Error('Usage: worktree-sim.ts <simulator name> [n] [launcher args]');
const extra = rest[0] && /^\d+$/.test(rest[0]) ? rest.shift() : undefined;
const name = extra ? `${base}-${extra}` : base;

const { devices } = json<{ devices: Record<string, { name: string; udid: string }[]> }>('devices', 'available');
let udid = Object.values(devices)
	.flat()
	.find(device => device.name === name)?.udid;

if (!udid) {
	const { runtimes } = json<{ runtimes: { identifier: string; isAvailable: boolean }[] }>('runtimes');
	const runtime = runtimes.filter(r => r.isAvailable && r.identifier.includes('SimRuntime.iOS-27')).at(-1);
	if (!runtime) throw new Error('No iOS 27 simulator runtime. Add one in Xcode settings.');
	const created = spawnSync(
		'xcrun',
		['simctl', 'create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', runtime.identifier],
		{ encoding: 'utf8' },
	);
	if (created.status !== 0) throw new Error(`Creating simulator ${name} failed\n${created.stderr}`);
	udid = created.stdout.trim();
	console.log(`Created simulator ${name}.`);
}

process.exit(spawnSync('bun', ['app-ios/scripts/run', '-t', udid, ...rest], { stdio: 'inherit' }).status ?? 1);
