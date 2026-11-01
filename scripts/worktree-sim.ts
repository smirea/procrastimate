/**
 * `./sim`, the git-ignored shim `bun run worktree:setup` writes (`bun scripts/worktree-sim.ts install`). The simulator
 * is `agent-simulator udid [n]`'s: named after the worktree directory, created and claimed on first use.
 *
 *   ./sim build [n]                    compile the app for the simulator without booting it
 *   ./sim [n] [launcher args]          build and run the app headless; --show opens Device Hub
 *   ./sim test [n] <file.swift>... [opts]  run throwaway XCUITests against the app (see sim-uitest.ts)
 *   ./sim stop                         shut down every simulator of this worktree
 *   ./sim udid [n]                     print the simulator's UDID, creating it if needed
 *
 * A headless boot (`./sim`, `./sim test`) first runs `agent-simulator wait`, which exits 3 when the Mac stays busy.
 * `n` picks an extra simulator named `<dir>-n`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentCommand, agentOutput } from './agent-command';
import { type Device, device as find, shutdown } from './simulators';
import { runUITests } from './sim-uitest';

const root = join(import.meta.dir, '..');
const shim = join(root, 'sim');
const args = process.argv.slice(2);

function install() {
	writeFileSync(shim, '#!/bin/sh\ncd "$(dirname "$0")" && exec bun scripts/worktree-sim.ts "$@"\n');
	chmodSync(shim, 0o755);
}

// Shims written before agent-simulator passed the simulator name first; it now follows from the directory.
const legacyName = existsSync(shim) ? readFileSync(shim, 'utf8').match(/worktree-sim\.ts '([^']+)'/)?.[1] : undefined;
if (legacyName) {
	if (args[0] === legacyName) args.shift();
	install();
}

const command = ['install', 'build', 'test', 'stop', 'udid'].includes(args[0] ?? '') ? args.shift()! : 'run';
const extra = args[0] && /^\d+$/.test(args[0]) ? args.shift() : undefined;

// A permission alert raised before the launcher started granting survives later grants and relaunches; only a reboot
// clears it. The launcher grants before every launch, so one reboot per simulator is enough. The marker lives in the
// simulator's data directory, so erasing the simulator resets it too.
const alertsCleared = (device: Device) => join(device.dataPath, 'procrastimate-permission-alerts-cleared');

function ensure(): Device {
	const device = find(agentOutput('agent-simulator', ['udid', ...(extra ? [extra] : [])]));
	if (!existsSync(alertsCleared(device)) && device.state === 'Booted') {
		console.log(
			`Rebooting ${device.name} to clear any permission alert left from before the launcher granted permissions.`,
		);
		shutdown(device);
		device.state = 'Shutdown';
	}
	writeFileSync(alertsCleared(device), '');
	return device;
}

function waitForRoom(device: Device) {
	const code = agentCommand('agent-simulator', ['wait', device.udid]);
	if (code !== 0) process.exit(code);
}

const launch = (launcher: string[]) =>
	spawnSync('bun', ['app-ios/scripts/run', ...launcher], { cwd: root, stdio: 'inherit' }).status ?? 1;

if (command === 'install') {
	install();
} else if (command === 'stop') {
	process.exitCode = agentCommand('agent-simulator', ['stop']);
} else if (command === 'udid') {
	console.log(ensure().udid);
} else if (command === 'build') {
	process.exitCode = launch(['-t', ensure().udid, '--build-only']);
} else if (command === 'test') {
	const device = ensure();
	waitForRoom(device);
	process.exitCode = await runUITests(device, root, args);
} else if (args.some(arg => ['-h', '--help', '--targets'].includes(arg))) {
	process.exitCode = launch(args);
} else {
	const device = ensure();
	const show = args.includes('--show');
	// --show is the owner watching; only agents' headless boots wait.
	if (!show) waitForRoom(device);
	process.exitCode = launch([
		'-t',
		device.udid,
		...(show ? [] : ['--headless']),
		...args.filter(arg => arg !== '--show'),
	]);
}
