import { expect, test } from 'bun:test';
import { workerSecrets } from './secrets';

test('workerSecrets keeps only set Worker secrets', () => {
	expect(
		workerSecrets({
			BETTER_AUTH_SECRET: 'secret',
			CLOUDFLARE_API_TOKEN: 'token',
			API_PORT: '6121',
			ELEVENLABS_API_KEY: '',
		}),
	).toEqual({ BETTER_AUTH_SECRET: 'secret' });
	expect(workerSecrets({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).toEqual({
		VAPID_PUBLIC_KEY: 'pub',
		VAPID_PRIVATE_KEY: 'priv',
	});
});

test('workerSecrets refuses half a VAPID pair', () => {
	expect(() => workerSecrets({ VAPID_PUBLIC_KEY: 'pub' })).toThrow(/VAPID/);
	expect(() => workerSecrets({ VAPID_PRIVATE_KEY: 'priv' })).toThrow(/VAPID/);
});
