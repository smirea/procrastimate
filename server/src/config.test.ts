import { expect, test } from 'bun:test';
import { EPHEMERAL_AUTH_SECRET, parseConfig, REQUIRED_WORKER_SECRETS } from './config';
import { VAPID_SUBJECT } from './web-push';

const production = {
	BETTER_AUTH_SECRET: 'secret',
	TURSO_DATABASE_URL: 'libsql://procrastimate-prod.turso.io',
	TURSO_AUTH_TOKEN: 'token',
	VAPID_PUBLIC_KEY: 'public',
	VAPID_PRIVATE_KEY: 'private',
};

test('a production Worker names every missing secret', () => {
	expect(() => parseConfig({})).toThrow(
		[
			'Invalid server configuration:',
			'- Missing BETTER_AUTH_SECRET',
			'- Missing TURSO_DATABASE_URL, TURSO_AUTH_TOKEN',
			'- Missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY',
		].join('\n'),
	);
	expect(() => parseConfig({ ...production, TURSO_AUTH_TOKEN: ' ' })).toThrow('- Missing TURSO_AUTH_TOKEN');
});

test('a production Worker with its secrets has Turso, push, and no optional providers', () => {
	expect(parseConfig(production)).toEqual({
		ephemeral: false,
		authSecret: 'secret',
		turso: { url: 'libsql://procrastimate-prod.turso.io', authToken: 'token' },
		vapid: { publicKey: 'public', privateKey: 'private', subject: VAPID_SUBJECT },
		google: { web: null, iosClientId: null },
		apple: null,
		ramble: null,
	});
});

test('an ephemeral run needs no secrets and ignores Turso', () => {
	expect(parseConfig({ EPHEMERAL: '1', TURSO_DATABASE_URL: 'libsql://dev.turso.io', TURSO_AUTH_TOKEN: 't' })).toEqual({
		ephemeral: true,
		authSecret: EPHEMERAL_AUTH_SECRET,
		turso: null,
		vapid: null,
		google: { web: null, iosClientId: null },
		apple: null,
		ramble: null,
	});
	expect(() => parseConfig({ EPHEMERAL: 'true' })).toThrow('EPHEMERAL must be 1 or unset, not "true"');
	expect(() => parseConfig({ EPHEMERAL: '1', VAPID_PUBLIC_KEY: 'public' })).toThrow(
		'- Set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or none (missing VAPID_PRIVATE_KEY)',
	);
});

test('optional providers are all or nothing', () => {
	expect(() => parseConfig({ ...production, GOOGLE_CLIENT_ID: 'web' })).toThrow(
		'- Set all of GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or none (missing GOOGLE_CLIENT_SECRET)',
	);
	expect(() => parseConfig({ ...production, APPLE_CLIENT_ID: 'services' })).toThrow(
		'- APPLE_CLIENT_ID needs APPLE_CLIENT_SECRET, or APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY',
	);
	expect(() =>
		parseConfig({ ...production, APPLE_TEAM_ID: 'team', APPLE_KEY_ID: 'key', APPLE_PRIVATE_KEY: 'x' }),
	).toThrow('- APPLE_PRIVATE_KEY is not a PKCS8 PEM');
	expect(() => parseConfig({ ...production, RAMBLE_UPSTREAM: 'elevenlabs' })).toThrow(
		'- RAMBLE_UPSTREAM must be cassette or unset, not "elevenlabs"',
	);
	expect(
		parseConfig({
			...production,
			GOOGLE_IOS_CLIENT_ID: 'ios',
			APPLE_TEAM_ID: 'team',
			APPLE_KEY_ID: 'key',
			APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
			ELEVENLABS_API_KEY: 'eleven',
		}),
	).toMatchObject({
		google: { web: null, iosClientId: 'ios' },
		apple: {
			servicesId: null,
			secret: {
				kind: 'key',
				teamId: 'team',
				keyId: 'key',
				pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
			},
		},
		ramble: { kind: 'elevenlabs', apiKey: 'eleven' },
	});
});

test('the deploy check and the parser require the same secrets', () => {
	expect(Object.keys(production).sort()).toEqual([...REQUIRED_WORKER_SECRETS].sort());
	for (const name of REQUIRED_WORKER_SECRETS) {
		expect(() => parseConfig({ ...production, [name]: undefined })).toThrow(name);
	}
});
