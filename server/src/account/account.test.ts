import { expect, test } from 'bun:test';
import { accountName } from './account';
import type { Env } from '../bindings';

const request = (cookie?: string) => new Request('https://app.test/api/sync', { headers: cookie ? { cookie } : {} });

test('the account name ignores the e2e cookie unless sharding is on', () => {
	const cookie = 'e2e-account=11111111-1111-1111-1111-111111111111';
	expect(accountName(request(cookie), {})).toBe('account');
	expect(accountName(request(cookie), { E2E_SHARD: '1' })).toBe('account:11111111-1111-1111-1111-111111111111');
	expect(accountName(request(), { E2E_SHARD: '1' })).toBe('account');
	expect(accountName(request('e2e-account=short'), { E2E_SHARD: '1' })).toBe('account');
});

test('a sharded name only accepts the cookie token', () => {
	const env: Env = { E2E_SHARD: '1' };
	expect(accountName(request('theme=dark; e2e-account=abcdef12-3456-7890-abcd-ef1234567890; other=1'), env)).toBe(
		'account:abcdef12-3456-7890-abcd-ef1234567890',
	);
});
