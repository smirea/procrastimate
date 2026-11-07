import { expect, test } from 'bun:test';
import { parseDotenv } from './lib';

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
