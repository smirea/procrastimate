import { createORPCClient, ORPCError } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi/fetch';
import type { ApiClient, contract } from 'shared/api/contract.ts';
import { CLIENT_HEADER, DEVICE_HEADER, DEVICE_NAME_HEADER } from 'shared/auth.ts';
import type { Client } from 'shared/values.ts';
import routes from './generated/contract.json';
import { store } from './store.svelte.ts';

/** The browser and its OS, such as `Chrome` and `macOS`, or an empty OS when the user agent names none. */
function browser(): { name: string; os: string } {
	const ua = navigator.userAgent;
	const name = /Edg\//.test(ua)
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
	return { name, os };
}

/** A name stored with the device, such as `Chrome on macOS`. It is never shown. */
function deviceName(): string {
	const { name, os } = browser();
	return os ? `${name} on ${os}` : name;
}

/** This app, which the server records on every op a request writes. The deploy's commit is the version. */
function client(): Client {
	const { name, os } = browser();
	return {
		kind: 'web',
		version: __SENTRY_TARGET__?.release ?? null,
		device: name,
		os: os || null,
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	};
}

/** The install id and name, and the app. The session cookie is the credential; these are not. */
export function deviceHeaders(): Record<string, string> {
	const app = { [CLIENT_HEADER]: JSON.stringify(client()) };
	const id = store.deviceId();
	if (!id) return app;
	return { ...app, [DEVICE_HEADER]: id, [DEVICE_NAME_HEADER]: deviceName() };
}

/**
 * The typed client for every endpoint in the contract. It ships the contract's routes without their schemas, which
 * `scripts/generate` writes from the same contract, so the bundle carries no validators it does not use.
 */
export const api: ApiClient = createORPCClient(
	new OpenAPILink(routes as unknown as typeof contract, {
		headers: deviceHeaders,
		fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
	}),
);

export const isUnauthorized = (error: unknown) => error instanceof ORPCError && error.code === 'UNAUTHORIZED';
