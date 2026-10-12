import { expect, test } from 'bun:test';
import { createORPCClient, ORPCError } from '@orpc/client';
import { minifyContractRouter } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi/fetch';
import { contract, type ApiClient } from '../../shared/api/contract';
import { memoryAccount } from './account/account';
import { withAuth } from './account/test-device';
import api from './api';

/** The web client's link, routes without schemas included, against the Worker in this process. */
const client = (): ApiClient => {
	const env = withAuth({ ACCOUNT: memoryAccount() });
	return createORPCClient(
		new OpenAPILink(minifyContractRouter(contract), {
			origin: 'https://procrastimate.test',
			fetch: (url, init) => api.fetch(new Request(url, init), env),
		}),
	);
};

const codeOf = (call: Promise<unknown>) =>
	call.then(
		() => 'resolved',
		(error: unknown) => (error instanceof ORPCError ? error.code : String(error)),
	);

test('a signed-out client gets UNAUTHORIZED from the Worker and from the Account object', async () => {
	const api = client();
	expect(await codeOf(api.sync({ cursor: 0, ops: [] }))).toBe('UNAUTHORIZED');
	expect(await codeOf(api.push.schedule())).toBe('UNAUTHORIZED');
	expect(await codeOf(api.account.delete())).toBe('UNAUTHORIZED');
});
