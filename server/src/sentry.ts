import { COMMON_ERROR_STATUS_MAP, ORPCError, ValidationError } from '@orpc/server';
import {
	captureException,
	cronTriggersIntegration,
	httpServerIntegration,
	setUser,
	startSpan,
	type CloudflareOptions,
	type ErrorEvent,
	type SeverityLevel,
} from '@sentry/cloudflare';
import type { Actor } from '../../shared/auth';
import { envelopeUrl, parseDsn, SENTRY_DSN, SENTRY_TUNNEL_PATH, type SentryTarget } from '../../shared/sentry';
import type { Env, Handler } from './bindings';
import { config } from './config';

/**
 * The server's one Sentry module. `worker.ts` wraps the handler and the `Account` object with `sentryOptions`, and
 * `index.ts` starts `@sentry/bun` with `serverOptions` for the dev server. Feature code calls `span`, `identify`, and
 * `reportError`, which go through `@sentry/core`'s global client, so they work under either SDK and do nothing where
 * no client is set up: tests and any run without `SENTRY_ENVIRONMENT`.
 */

const isTunnel = (url: string | undefined) => {
	try {
		return new URL(url ?? '', 'http://x').pathname === SENTRY_TUNNEL_PATH;
	} catch {
		return false;
	}
};

/** What the Worker and the Bun dev server share. Every request, header, cookie, and body is collected, by default. */
export function serverOptions({ dsn, environment, release }: SentryTarget) {
	return {
		dsn,
		environment,
		release,
		// Whole transactions named by method and path; streamed spans are named only by method.
		traceLifecycle: 'static' as const,
		// The tunnel's own requests would add a transaction for every envelope the browser sends.
		tracesSampler: ({ name, inheritOrSampleWith }: { name: string; inheritOrSampleWith: (rate: number) => number }) =>
			name === `POST ${SENTRY_TUNNEL_PATH}` ? 0 : inheritOrSampleWith(1),
		// An error while forwarding an envelope must not carry the envelope as its request body.
		beforeSend: (event: ErrorEvent) => {
			if (event.request && isTunnel(event.request.url)) delete event.request.data;
			return event;
		},
	};
}

export function sentryOptions(env: Env): CloudflareOptions {
	const { sentry } = config(env);
	if (!sentry) return { enabled: false };
	return {
		...serverOptions(sentry),
		integrations: [
			// The default caps a body at 10 KB; a sync body is the one worth reading whole.
			httpServerIntegration({ maxRequestBodySize: 'always', ignoreRequestBody: isTunnel }),
			// A Sentry cron monitor, so a backup that never runs alerts, not only one that throws.
			cronTriggersIntegration({ monitorSlug: () => 'turso-backup' }),
		],
	};
}

export const span = <T>(name: string, op: string, run: () => T): T => startSpan({ name, op }, run);

export const identify = ({ id, name, email }: Actor) => setUser({ id, username: name, ...(email ? { email } : {}) });

/** A failure no request answers with an error, or one the handler already turned into a response. */
export function reportError(error: unknown, level: SeverityLevel = 'error', extra?: Record<string, unknown>) {
	captureException(error, { level, extra });
}

/**
 * oRPC turns a thrown error into a response, so `withSentry` never sees it. A 5xx, or anything that is not an
 * `ORPCError`, is a bug; an input that fails the contract is a client sending what it should not, so a warning.
 */
export function reportRpcError(error: unknown) {
	if (!(error instanceof ORPCError)) return reportError(error);
	const status = COMMON_ERROR_STATUS_MAP[error.code as keyof typeof COMMON_ERROR_STATUS_MAP] ?? 500;
	if (status >= 500) return reportError(error.cause ?? error);
	if (error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
		console.warn('invalid request', JSON.stringify(error.cause.issues).slice(0, 2000));
		reportError(error, 'warning', { issues: error.cause.issues });
	}
}

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
