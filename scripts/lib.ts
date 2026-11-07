/** What the repository scripts share: a process runner and the dotenv reader. No npm imports. */
import { spawnSync } from 'node:child_process';

export type Values = Record<string, string>;

/** Runs a command to completion and answers its trimmed stdout. A failure names the command and shows its output. */
export function run(cmd: string[]): string {
	const result = spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`\`${cmd.join(' ')}\` failed\n${result.stderr ?? ''}${result.stdout ?? ''}`);
	}
	return (result.stdout ?? '').trim();
}

/** Empty values count as unset and are left out. */
export function parseDotenv(text: string): Values {
	const values: Values = {};
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		const [, key, rest] = match as unknown as [string, string, string];
		let value: string;
		const quote = rest[0];
		if ((quote === '"' || quote === "'") && rest.indexOf(quote, 1) > 0) {
			value = rest.slice(1, rest.indexOf(quote, 1));
		} else {
			value = rest.replace(/(^|\s+)#.*$/, '').trim();
		}
		if (value) values[key] = value;
	}
	return values;
}
