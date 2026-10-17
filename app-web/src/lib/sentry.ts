import * as Sentry from '@sentry/sveltekit';
import { SENTRY_TUNNEL_PATH } from 'shared/sentry.ts';

/**
 * The browser's one Sentry module. `vite.config.ts` bakes the target into the build, null wherever no
 * `SENTRY_ENVIRONMENT` is set, and then nothing is initialized and every call here does nothing.
 */

export function initSentry() {
	if (!__SENTRY_TARGET__) return;
	const { dsn, environment, release } = __SENTRY_TARGET__;
	Sentry.init({
		dsn,
		environment,
		release,
		tunnel: SENTRY_TUNNEL_PATH,
		// A 5xx from the API becomes a browser event in the same trace as the server's own.
		integrations: [Sentry.httpClientIntegration({ failedRequestTargets: [/\/api\//] })],
		// Whole transactions named by route, like the Worker's.
		traceLifecycle: 'static',
		tracesSampleRate: 1,
		beforeSend: import.meta.env.DEV
			? event => import('./sentry-dev-frames.ts').then(({ mapDevFrames }) => mapDevFrames(event))
			: undefined,
	});
}

export type SentryUser = { id: string; email?: string; name?: string };

export const identify = (user: SentryUser | null) =>
	Sentry.setUser(user && { id: user.id, email: user.email, username: user.name });

/** A failure the app handles on its own, so nothing reaches the global handlers. */
export const reportError = (error: unknown, extra?: Record<string, unknown>) =>
	Sentry.captureException(error, { extra });

export const reportWarning = (message: string, extra?: Record<string, unknown>) =>
	Sentry.captureMessage(message, { level: 'warning', extra });

export const handleError = Sentry.handleErrorWithSentry();

/**
 * `?sentry-smoke` on any page, once the session has named the user: the Worker and the `Account` object throw from debug
 * routes, then this throws, so each project gets an event in one trace. `scripts/sentry-check.ts` reads them back.
 */
export async function runSentrySmoke() {
	if (!new URL(location.href).searchParams.has('sentry-smoke')) return;
	// Loaded here, so this module, which `hooks.client.ts` imports first, does not pull in the store.
	const { api } = await import('./api.ts');
	await api.debug.error().catch(() => undefined);
	await api.debug.accountError().catch(() => undefined);
	throwSentrySmoke();
}

function throwSentrySmoke(): never {
	throw new Error('Sentry smoke test: web');
}
