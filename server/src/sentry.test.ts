import { expect, spyOn, test } from 'bun:test';
import { sentryTunnel, tunnelDestination } from './sentry';
import { testEnv } from './test-app';

const WEB_DSN = 'https://0123abcd@o42.ingest.us.sentry.io/7';
const envelope = (header: string) => new TextEncoder().encode(`${header}\n{"type":"event"}\n{}`);

test('an envelope for the web project goes to its ingest endpoint', () => {
	expect(tunnelDestination(envelope(`{"dsn":"${WEB_DSN}","sent_at":"2026-10-17T00:00:00Z"}`), WEB_DSN)).toBe(
		'https://o42.ingest.us.sentry.io/api/7/envelope/',
	);
});

test('an envelope for any other project, or without a DSN, is refused', () => {
	for (const header of [
		'{"dsn":"https://0123abcd@o42.ingest.us.sentry.io/8"}',
		'{"dsn":"https://0123abcd@evil.example/7"}',
		'{"sent_at":"2026-10-17T00:00:00Z"}',
		'not json',
		'null',
	]) {
		expect(tunnelDestination(envelope(header), WEB_DSN)).toBeNull();
	}
});

test('nothing is forwarded while the web DSN is not provisioned', () => {
	expect(tunnelDestination(envelope(`{"dsn":"${WEB_DSN}"}`), '')).toBeNull();
});

test('a browser that disconnects mid-envelope gets an answer, and nothing is forwarded or thrown', async () => {
	const env = await testEnv({ SENTRY_ENVIRONMENT: 'production', SENTRY_RELEASE: 'test' });
	const body = new ReadableStream({
		start(controller) {
			controller.error(new TypeError("Can't read from request stream because client disconnected."));
		},
	});
	const forward = spyOn(globalThis, 'fetch');
	try {
		const request = new Request('https://app.test/api/sentry', { method: 'POST', body, duplex: 'half' } as RequestInit);
		expect((await sentryTunnel(request, env)).status).toBe(400);
		expect(forward).not.toHaveBeenCalled();
	} finally {
		forward.mockRestore();
	}
});
