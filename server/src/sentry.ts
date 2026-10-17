import { setUser, startSpan, type CloudflareOptions } from '@sentry/cloudflare';
import { envelopeUrl, parseDsn, SENTRY_DSN } from '../../shared/sentry';
import type { Env, Handler } from './bindings';
import { config } from './config';

/**
 * The Worker's one Sentry module. `worker.ts` wraps the handler and the `Account` object with these options; feature
 * code only calls `span` and `identify`, which do nothing where no client is set up: the Bun dev server, tests, and
 * a Worker without `SENTRY_ENVIRONMENT`.
 */

export const SENTRY_TUNNEL_PATH = '/api/sentry';

export function sentryOptions(env: Env): CloudflareOptions {
	const { sentry } = config(env);
	if (!sentry) return { enabled: false };
	return {
		dsn: sentry.dsn,
		environment: sentry.environment,
		release: sentry.release,
		// Whole transactions named by method and path; streamed spans are named only by method.
		traceLifecycle: 'static',
		// The tunnel's own requests would add a transaction for every envelope the browser sends.
		tracesSampler: ({ name, inheritOrSampleWith }) =>
			name === `POST ${SENTRY_TUNNEL_PATH}` ? 0 : inheritOrSampleWith(1),
	};
}

export const span = <T>(name: string, op: string, run: () => T): T => startSpan({ name, op }, run);

export const identify = (id: string) => setUser({ id });

const decoder = new TextDecoder();

/**
 * Where an envelope from the browser goes: its header's DSN, only when that is the web project's. Anything else
 * is refused, so the tunnel cannot be used to post to another Sentry project.
 */
export function tunnelDestination(envelope: Uint8Array, allowedDsn: string): string | null {
	const allowed = parseDsn(allowedDsn);
	if (!allowed) return null;
	const newline = envelope.indexOf(10);
	let header: unknown;
	try {
		header = JSON.parse(decoder.decode(newline < 0 ? envelope : envelope.subarray(0, newline)));
	} catch {
		return null;
	}
	const raw = (header as { dsn?: unknown } | null)?.dsn;
	const dsn = typeof raw === 'string' ? parseDsn(raw) : null;
	if (!dsn || dsn.host !== allowed.host || dsn.projectId !== allowed.projectId) return null;
	return envelopeUrl(allowed);
}

const RATE_LIMIT_HEADERS = ['x-sentry-rate-limits', 'retry-after'];

/** `POST /api/sentry`: the browser's only way to Sentry, since it talks to its own origin alone. */
export const sentryTunnel: Handler = async (request, env) => {
	if (!config(env).sentry) return new Response(null, { status: 204 });
	const envelope = new Uint8Array(await request.arrayBuffer());
	const destination = tunnelDestination(envelope, SENTRY_DSN.web);
	if (!destination) return new Response(null, { status: 400 });
	const upstream = await fetch(destination, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-sentry-envelope' },
		body: envelope,
	});
	const headers = new Headers();
	for (const name of RATE_LIMIT_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	await upstream.body?.cancel();
	return new Response(null, { status: upstream.status, headers });
};
