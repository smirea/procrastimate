/**
 * `./sim`, the git-ignored wrapper setup-worktree.ts writes, calls this with the worktree's simulator name.
 *
 *   ./sim build [n]                    compile the app for the simulator without booting it
 *   ./sim [n] [launcher args]          build and run the app headless; --show opens Device Hub
 *   ./sim test [n] <file.swift>... [opts]  run throwaway XCUITests against the app (see sim-uitest.ts)
 *   ./sim stop                         shut down every simulator of this worktree
 *   ./sim udid [n]                     print the simulator's UDID, creating it if needed
 *
 * `n` picks an extra simulator named `<name>-n`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claim, type Device, devices, shutdown, simctl } from './simulators';
import { runUITests } from './sim-uitest';

const [base, ...args] = process.argv.slice(2);
if (!base) throw new Error('Usage: worktree-sim.ts <simulator name> [command] [n] [args]');
const root = process.cwd();
const command = ['build', 'test', 'stop', 'udid'].includes(args[0] ?? '') ? args.shift()! : 'run';
const extra = args[0] && /^\d+$/.test(args[0]) ? args.shift() : undefined;
const name = extra ? `${base}-${extra}` : base;
const find = () => devices().find(device => device.name === name);

// A permission alert raised before the launcher started granting survives later grants and relaunches; only a reboot
// clears it. The launcher grants before every launch, so one reboot per simulator is enough. The marker lives in the
// simulator's data directory, so erasing the simulator resets it too.
const alertsCleared = (device: Device) => join(device.dataPath, 'procrastimate-permission-alerts-cleared');

function ensure(): Device {
	let device = find();
	if (device && !existsSync(alertsCleared(device)) && device.state === 'Booted') {
		console.log(`Rebooting ${name} to clear any permission alert left from before the launcher granted permissions.`);
		shutdown(device);
	}
	if (!device) {
		const { runtimes } = JSON.parse(simctl('list', 'runtimes', '--json')) as {
			runtimes: { identifier: string; isAvailable: boolean }[];
		};
		const runtime = runtimes.filter(r => r.isAvailable && r.identifier.includes('SimRuntime.iOS-27')).at(-1);
		if (!runtime) throw new Error('No iOS 27 simulator runtime. Add one in Xcode settings.');
		simctl('create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', runtime.identifier);
		console.log(`Created simulator ${name}.`);
		device = find();
		if (!device) throw new Error(`simctl created ${name} but does not list it.`);
	}
	claim(device, root);
	writeFileSync(alertsCleared(device), '');
	return device;
}

if (command === 'stop') {
	const own = devices().filter(
		device => device.name === base || new RegExp(`^${RegExp.escape(base)}-\\d+$`).test(device.name),
	);
	for (const device of own.filter(device => device.state !== 'Shutdown')) {
		shutdown(device);
		console.log(`Shut down ${device.name}.`);
	}
	if (!own.some(device => device.state !== 'Shutdown')) console.log('No simulator of this worktree is running.');
} else if (command === 'udid') {
	console.log(ensure().udid);
} else if (command === 'build') {
	process.exitCode =
		spawnSync('bun', ['app-ios/scripts/run', '-t', ensure().udid, '--build-only'], { stdio: 'inherit' }).status ?? 1;
} else if (command === 'test') {
	process.exitCode = await runUITests(ensure(), root, args);
} else if (args.some(arg => ['-h', '--help', '--targets'].includes(arg))) {
	process.exitCode = spawnSync('bun', ['app-ios/scripts/run', ...args], { stdio: 'inherit' }).status ?? 1;
} else {
	const device = ensure();
	const show = args.includes('--show');
	const launcher = args.filter(arg => arg !== '--show');
	process.exitCode =
		spawnSync('bun', ['app-ios/scripts/run', '-t', device.udid, ...(show ? [] : ['--headless']), ...launcher], {
			stdio: 'inherit',
		}).status ?? 1;
}
