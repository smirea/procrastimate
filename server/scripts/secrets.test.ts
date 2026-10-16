import { expect, test } from 'bun:test';
import {
	GITHUB_SECRETS,
	appIosKeys,
	iosXcconfig,
	parseDotenv,
	PROD_API_URL,
	WORKER_SECRETS,
	workerSecrets,
} from './secrets';

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

const schema = await Bun.file(new URL('../../.env', import.meta.url)).text();

test('the iOS target is API_URL, and Debug and Release take dev and prod', () => {
	expect(appIosKeys(schema).map(key => key.name)).toEqual(['API_URL']);
	const text = iosXcconfig(schema, { API_URL: 'http://192.168.1.9:6121' }, { API_URL: PROD_API_URL });
	expect(text).toContain('API_URL[config=Debug] = http:/$()/192.168.1.9:6121');
	expect(text).toContain(`API_URL[config=Release] = https:/$()/procrastimate.stf.lol`);
	expect(text).not.toContain('ELEVENLABS');
});

test('an offline iOS config uses the dev schema default and the pinned prod URL', () => {
	const text = iosXcconfig(schema, {}, {});
	expect(text).toContain('API_URL[config=Debug] = http:/$()/127.0.0.1:6121');
	expect(text).toContain(`API_URL[config=Release] = https:/$()/procrastimate.stf.lol`);
});

test('wrangler.jsonc declares no vars that a deploy would write over a secret', async () => {
	const config = Bun.JSONC.parse(await Bun.file(new URL('../../wrangler.jsonc', import.meta.url)).text()) as {
		vars?: Record<string, unknown>;
	};
	const vars = Object.keys(config.vars ?? {});
	expect(vars.filter(name => [...WORKER_SECRETS, ...GITHUB_SECRETS].includes(name as never))).toEqual([]);
});
