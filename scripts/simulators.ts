/** The simulator list, for what `agent-simulator` leaves to this repo: the permission-alert reboot and UI tests. */
import { spawnSync } from 'node:child_process';
import { run } from './lib';

export type Device = { name: string; udid: string; state: string; dataPath: string };

export function devices(): Device[] {
	const { devices } = JSON.parse(run(['xcrun', 'simctl', 'list', 'devices', '--json'])) as {
		devices: Record<string, Device[]>;
	};
	return Object.values(devices).flat();
}

export function device(udid: string): Device {
	const found = devices().find(entry => entry.udid === udid);
	if (!found) throw new Error(`simctl does not list ${udid}.`);
	return found;
}

export function shutdown(device: Device) {
	if (device.state !== 'Shutdown') spawnSync('xcrun', ['simctl', 'shutdown', device.udid]);
}
