import * as Sentry from '@sentry/sveltekit';

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
		// The browser talks only to its own origin; the Worker forwards the envelopes.
		tunnel: '/api/sentry',
		// Whole transactions named by route, like the Worker's.
		traceLifecycle: 'static',
		tracesSampleRate: 1,
	});
}

export const identify = (id: string | null) => Sentry.setUser(id ? { id } : null);

export const handleError = Sentry.handleErrorWithSentry();
