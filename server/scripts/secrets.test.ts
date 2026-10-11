import { expect, test } from 'bun:test';
import { GITHUB_SECRETS, parseDotenv, WORKER_SECRETS, workerSecrets } from './secrets';

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

test('workerSecrets keeps only set Worker secrets', () => {
	expect(
		workerSecrets({ SYNC_SETUP_CODE: 'code', CLOUDFLARE_API_TOKEN: 'token', API_PORT: '6121', ELEVENLABS_API_KEY: '' }),
	).toEqual({ SYNC_SETUP_CODE: 'code' });
	expect(workerSecrets({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).toEqual({
		VAPID_PUBLIC_KEY: 'pub',
		VAPID_PRIVATE_KEY: 'priv',
	});
});

test('workerSecrets refuses half a VAPID pair', () => {
	expect(() => workerSecrets({ VAPID_PUBLIC_KEY: 'pub' })).toThrow(/VAPID/);
	expect(() => workerSecrets({ VAPID_PRIVATE_KEY: 'priv' })).toThrow(/VAPID/);
});

test('wrangler.jsonc declares no vars that a deploy would write over a secret', async () => {
	const config = Bun.JSONC.parse(await Bun.file(new URL('../../wrangler.jsonc', import.meta.url)).text()) as {
		vars?: Record<string, unknown>;
	};
	const vars = Object.keys(config.vars ?? {});
	expect(vars.filter(name => [...WORKER_SECRETS, ...GITHUB_SECRETS].includes(name as never))).toEqual([]);
});
