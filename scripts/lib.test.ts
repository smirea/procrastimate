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

// Bun itself, since another test file may have narrowed `PATH` by the time this one runs.
const bun = process.execPath;

test('run answers trimmed output, and a failure names the command unless allowed', () => {
	expect(run([bun, '-e', "console.log(' hi ')"])).toBe('hi');
	expect(() => run([bun, '-e', 'process.exit(1)'])).toThrow('failed');
	expect(run([bun, '-e', 'process.exit(1)'], { allowFail: true })).toBe('');
});
