import { expect, test } from 'bun:test';
import { USER_HEADER } from '../../../shared/auth';
import { accountUserId } from './account';

const request = (user: string | null) =>
	new Request('https://procrastinate.test/api/sync', {
		headers: user === null ? undefined : { [USER_HEADER]: user },
	});

test('the account user id is the session header, never a shared fallback', () => {
	expect(accountUserId(request(null), 'user-1')).toBeNull();
	expect(accountUserId(request('   '), undefined)).toBeNull();
	expect(accountUserId(request('user-1'), undefined)).toBe('user-1');
	expect(accountUserId(request('user-1'), 'user-1')).toBe('user-1');
	expect(accountUserId(request('user-2'), 'user-1')).toBeNull();
});
