import { createORPCClient, ORPCError } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi/fetch';
import type { ApiClient, contract } from 'shared/api/contract.ts';
import { CLIENT_HEADER, DEVICE_HEADER, DEVICE_NAME_HEADER } from 'shared/auth.ts';
import type { Client } from 'shared/values.ts';
import routes from './generated/contract.json';
import { installId } from './device.ts';

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

/**
 * Push routes also carry the install id, since their subscription belongs to this browser. The session cookie is the
 * credential; these are not.
 */
export function deviceHeaders(path: readonly string[] = []): Record<string, string> {
	const app = { [CLIENT_HEADER]: JSON.stringify(client()) };
	if (path[0] !== 'push') return app;
	return { ...app, [DEVICE_HEADER]: installId(), [DEVICE_NAME_HEADER]: deviceName() };
}

/**
 * Ships the contract's routes without their schemas, which `scripts/generate` writes from the same contract, so the
 * bundle carries no validators it does not use.
 */
export const api: ApiClient = createORPCClient(
	new OpenAPILink(routes as unknown as typeof contract, {
		headers: (_options, path) => deviceHeaders(path),
		fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
	}),
);

export const isUnauthorized = (error: unknown) => error instanceof ORPCError && error.code === 'UNAUTHORIZED';
export const isNotFound = (error: unknown) => error instanceof ORPCError && error.code === 'NOT_FOUND';
