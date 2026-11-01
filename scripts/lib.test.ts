import { expect, test } from 'bun:test';
import { parseDotenv, run, TimeoutError } from './lib';

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

test('run kills a command at its timeout and throws TimeoutError, even with allowFail', () => {
	const started = Date.now();
	expect(() => run(['sh', '-c', '(sleep 5) & sleep 5'], { timeoutMs: 200, allowFail: true })).toThrow(TimeoutError);
	expect(Date.now() - started).toBeLessThan(2_000);
});
