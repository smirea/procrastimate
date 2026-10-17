import type { SentryTarget } from 'shared/sentry.ts';

declare global {
	namespace App {}
	/** Defined by `vite.config.ts`. */
	const __SENTRY_TARGET__: SentryTarget | null;
}

export {};
