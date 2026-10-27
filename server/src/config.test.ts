import { describe, expect, test } from 'bun:test';
import { parseConfig } from './config';
import { testEnv } from './test-app';

const DSN = 'https://key@o1.ingest.sentry.io/2';

describe('parseConfig', () => {
	test('names every missing or malformed key at once', async () => {
		const env = await testEnv({
			BETTER_AUTH_SECRET: '',
			VAPID_PRIVATE_KEY: '',
			AUTH_RATE_LIMIT: 'maybe',
		});
		expect(() => parseConfig(env, DSN)).toThrow(
			[
				'Invalid server configuration:',
				'- Missing BETTER_AUTH_SECRET',
				'- AUTH_RATE_LIMIT must be off or unset, not "maybe"',
				'- Missing VAPID_PRIVATE_KEY',
			].join('\n'),
		);
	});

	test('a key that does not decode to the right bytes fails at boot, not at first use', async () => {
		const env = await testEnv({
			VAPID_PUBLIC_KEY: 'not-a-key',
			VAPID_PRIVATE_KEY: 'nope',
		});
		expect(() => parseConfig(env, DSN)).toThrow(
			[
				'Invalid server configuration:',
				'- VAPID_PUBLIC_KEY is not an uncompressed P-256 point',
				'- VAPID_PRIVATE_KEY is not a 32-byte P-256 scalar',
			].join('\n'),
		);
	});
});
