import { createORPCClient, ORPCError } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi/fetch';
import type { ApiClient, contract } from 'shared/api/contract.ts';
import { CLIENT_HEADER, DEVICE_HEADER, DEVICE_NAME_HEADER } from 'shared/auth.ts';
import type { Client } from 'shared/values.ts';
import routes from './generated/contract.json';
import { installId } from './device.ts';

/** In order: Edge and Chrome both say `Chrome/`, and every WebKit browser says `Safari/`. */
const BROWSERS: [RegExp, string][] = [
	[/Edg\//, 'Edge'],
	[/Firefox\//, 'Firefox'],
	[/Chrome\//, 'Chrome'],
	[/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
	[/iPhone/, 'iPhone'],
	[/iPad/, 'iPad'],
	[/Android/, 'Android'],
	[/Mac OS X/, 'macOS'],
	[/Windows/, 'Windows'],
	[/Linux/, 'Linux'],
];
const match = (table: [RegExp, string][], ua: string) => table.find(([pattern]) => pattern.test(ua))?.[1];

/** Read once: the user agent does not change while the page lives. */
const browser = {
	name: match(BROWSERS, navigator.userAgent) ?? 'Browser',
	os: match(SYSTEMS, navigator.userAgent) ?? '',
};

const deviceName = browser.os ? `${browser.name} on ${browser.os}` : browser.name;

/** This app, which the server records on every op a request writes. The deploy's commit is the version. */
export function client(): Client {
	return {
		kind: 'web',
		version: __SENTRY_TARGET__?.release ?? null,
		device: browser.name,
		os: browser.os || null,
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
	return { ...app, [DEVICE_HEADER]: installId(), [DEVICE_NAME_HEADER]: deviceName };
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
