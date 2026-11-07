import { COMMON_ERROR_STATUS_MAP, ORPCError, ValidationError } from '@orpc/server';
import {
	captureException,
	cronTriggersIntegration,
	httpServerIntegration,
	setUser,
	type CloudflareOptions,
	type ErrorEvent,
	type SeverityLevel,
} from '@sentry/cloudflare';
import type { Actor } from '../../shared/auth';
import { envelopeUrl, parseDsn, SENTRY_DSN, SENTRY_TUNNEL_PATH } from '../../shared/sentry';
import { config, type Config, type Env } from './config';
import { CRONS, cronNamed } from './crons';

/**
 * The server's one Sentry module. `worker.ts` wraps the handler, the crons, and the `Ramble` object with
 * `sentryOptions`. Feature code calls `identify` and `reportError`, which go through `@sentry/core`'s global client, so
 * they do nothing where no client is set up: the Bun server, tests, and any run without `SENTRY_ENVIRONMENT`.
 */

const isTunnel = (url: string | undefined) => {
	try {
		return new URL(url ?? '', 'http://x').pathname === SENTRY_TUNNEL_PATH;
	} catch {
		return false;
	}
};

/** Every request, header, cookie, and body is collected, by default. */
export function sentryOptions(env: Env): CloudflareOptions {
	const { sentry } = config(env);
	if (!sentry) return { enabled: false };
	const { dsn, environment, release } = sentry;
	return {
		dsn,
		environment,
		release,
		// Errors only: no transactions or spans, from here or continued from a client, which never samples one either.
		// Recording every request cost most of a sync's Worker CPU and about 33 KB of envelopes. Errors still carry the
		// trace id the client sent, so one action's errors in every project stay linked.
		tracesSampleRate: 0,
		// An error while forwarding an envelope must not carry the envelope as its request body.
		beforeSend: (event: ErrorEvent) => {
			if (event.request && isTunnel(event.request.url)) delete event.request.data;
			return event;
		},
		integrations: [
			// The default caps a body at 10 KB; a sync body is the one worth reading whole.
			httpServerIntegration({ maxRequestBodySize: 'always', ignoreRequestBody: isTunnel }),
			// A Sentry cron monitor per trigger, so a cron that never runs alerts, not only one that throws.
			cronTriggersIntegration({ monitorSlug: cron => CRONS[cronNamed(cron)].monitor }),
		],
	};
}

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
export async function sentryTunnel(request: Request, { sentry }: Config): Promise<Response> {
	if (!sentry) return new Response(null, { status: 204 });
	// Only the browser can break its own upload, as when it leaves the page mid-send, so that is not the server's error.
	const body = await request.arrayBuffer().catch(() => null);
	if (!body) return new Response(null, { status: 400 });
	const envelope = new Uint8Array(body);
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
}
