import { describe, expect, test } from 'bun:test';
import { parseConfig } from './config';
import { testEnv } from './test-app';

const DSN = 'https://key@o1.ingest.sentry.io/2';

describe('parseConfig', () => {
	test('a complete environment parses, with the key’s kid and the PowerSync URL trimmed', async () => {
		const settings = parseConfig(await testEnv({ POWERSYNC_URL: 'http://127.0.0.1:1/' }), DSN);
		expect(settings.powersync).toMatchObject({
			url: 'http://127.0.0.1:1',
			key: { kid: 'insecure-local-dev-5d7cc3c8' },
		});
		expect(settings.authRateLimit).toBe(false);
		expect(settings.sentry).toBeNull();
	});

	test('names every missing or malformed key at once', async () => {
		const env = await testEnv({
			DATABASE_URL: '',
			POWERSYNC_URL: 'not a url',
			POWERSYNC_JWT_PRIVATE_KEY: '{"kty":"RSA"}',
			BETTER_AUTH_SECRET: '',
			VAPID_PRIVATE_KEY: '',
			AUTH_RATE_LIMIT: 'maybe',
		});
		expect(() => parseConfig(env, DSN)).toThrow(
			[
				'Invalid server configuration:',
				'- Missing BETTER_AUTH_SECRET',
				'- AUTH_RATE_LIMIT must be off or unset, not "maybe"',
				'- Missing the HYPERDRIVE binding or DATABASE_URL',
				'- POWERSYNC_URL is not a URL',
				'- POWERSYNC_JWT_PRIVATE_KEY must be an Ed25519 OKP JWK',
				'- Missing VAPID_PRIVATE_KEY',
			].join('\n'),
		);
	});

	test('a key that does not decode to the right bytes fails at boot, not at first use', async () => {
		const env = await testEnv({
			VAPID_PUBLIC_KEY: 'not-a-key',
			VAPID_PRIVATE_KEY: 'nope',
			POWERSYNC_JWT_PRIVATE_KEY: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', kid: 'k', x: 'x', d: 'd' }),
		});
		expect(() => parseConfig(env, DSN)).toThrow(
			[
				'Invalid server configuration:',
				"- POWERSYNC_JWT_PRIVATE_KEY's x is not a 32-byte Ed25519 key",
				'- VAPID_PUBLIC_KEY is not an uncompressed P-256 point',
				'- VAPID_PRIVATE_KEY is not a 32-byte P-256 scalar',
			].join('\n'),
		);
	});

	test('the Hyperdrive binding stands in for DATABASE_URL', async () => {
		const env = await testEnv({ DATABASE_URL: '' });
		const settings = parseConfig(
			{ ...env, HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' } as never },
			DSN,
		);
		expect(settings.database).toBe('postgres://hyperdrive/db');
	});

	test('Ramble reads the cassette switch or the ElevenLabs key', async () => {
		expect(parseConfig(await testEnv({ RAMBLE_UPSTREAM: 'cassette' }), DSN).ramble).toEqual({ kind: 'cassette' });
		expect(parseConfig(await testEnv({ ELEVENLABS_API_KEY: 'xi' }), DSN).ramble).toEqual({
			kind: 'elevenlabs',
			apiKey: 'xi',
		});
		expect(parseConfig(await testEnv(), DSN).ramble).toBeNull();
	});
});
