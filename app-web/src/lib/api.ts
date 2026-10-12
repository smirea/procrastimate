import { createORPCClient, ORPCError } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import type { ApiClient, contract } from 'shared/api/contract.ts';
import { DEVICE_HEADER, DEVICE_NAME_HEADER } from 'shared/auth.ts';
import routes from './generated/contract.json';
import { store } from './store.svelte.ts';

/** A name stored with the device, such as `Chrome on macOS`. It is never shown. */
function deviceName(): string {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /Firefox\//.test(ua)
			? 'Firefox'
			: /Chrome\//.test(ua)
				? 'Chrome'
				: /Safari\//.test(ua)
					? 'Safari'
					: 'Browser';
	const os = /iPhone/.test(ua)
		? 'iPhone'
		: /iPad/.test(ua)
			? 'iPad'
			: /Android/.test(ua)
				? 'Android'
				: /Mac OS X/.test(ua)
					? 'macOS'
					: /Windows/.test(ua)
						? 'Windows'
						: /Linux/.test(ua)
							? 'Linux'
							: '';
	return os ? `${browser} on ${os}` : browser;
}

/** The install id and name. The session cookie is the credential; these are not. */
export function deviceHeaders(): Record<string, string> {
	const id = store.deviceId();
	if (!id) return {};
	return { [DEVICE_HEADER]: id, [DEVICE_NAME_HEADER]: deviceName() };
}

/**
 * The typed client for every endpoint in the contract. It ships the contract's routes without their schemas, which
 * `scripts/generate` writes from the same contract, so the bundle carries no validators it does not use.
 */
export const api: ApiClient = createORPCClient(
	new OpenAPILink(routes as unknown as typeof contract, {
		url: () => location.origin,
		headers: deviceHeaders,
		fetch: (request, init) => fetch(request, { ...init, credentials: 'include' }),
	}),
);

/** A `401`, which ends the session. */
export const isUnauthorized = (error: unknown) => error instanceof ORPCError && error.status === 401;
