import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import { createORPCClient } from '@orpc/client';
import type { RouterContractClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi/fetch';
import { internalContract } from '../../../shared/api/contract';

export type InternalClient = RouterContractClient<typeof internalContract>;

/**
 * A typed client for one space's internal routes, which only the Worker and other `Account` objects reach: the
 * Worker never forwards them, so they carry no actor. `origin` only shapes the URL; the object ignores the host.
 */
export function internalClient(namespace: DurableObjectNamespace, spaceId: string, origin: string): InternalClient {
	const stub = namespace.get(namespace.idFromName(spaceId));
	return createORPCClient(
		new OpenAPILink(internalContract, {
			origin,
			fetch: (url, init) => stub.fetch(new Request(url, init) as never) as unknown as Promise<Response>,
		}),
	);
}
