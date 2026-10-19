import { expect, test } from 'bun:test';
import { parseDotenv, run } from './lib';

test('parseDotenv reads plain, quoted, and commented values and drops empty ones', () => {
	const text = [
		'# env-manager: procrastimate',
		'PLAIN=abc',
		"SINGLE='a # b'",
		'DOUBLE="c d"',
		'COMMENTED=xyz # {optional string}',
		'EMPTY= # {optional string}',
		'BARE=',
		'EMPTY_QUOTED=""',
		'HASH_IN_VALUE=a#b',
		'',
	].join('\n');
	expect(parseDotenv(text)).toEqual({
		PLAIN: 'abc',
		SINGLE: 'a # b',
		DOUBLE: 'c d',
		COMMENTED: 'xyz',
		HASH_IN_VALUE: 'a#b',
	});
});

// `/bin/sh`, not a second Bun: a spawned `bun -e` exited non-zero in agent worktrees while CI passed, and `run` only
// needs some process that prints and exits.
test('run answers trimmed output, and a failure names the command unless allowed', () => {
	expect(run(['/bin/sh', '-c', "echo ' hi '"])).toBe('hi');
	expect(() => run(['/bin/sh', '-c', 'exit 1'])).toThrow('`/bin/sh -c exit 1` failed');
	expect(run(['/bin/sh', '-c', 'exit 1'], { allowFail: true })).toBe('');
});
