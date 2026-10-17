import type { SentryTarget } from 'shared/sentry.ts';

declare global {
	namespace App {}
	/** Defined by `vite.config.ts`. */
	const __SENTRY_TARGET__: SentryTarget | null;
	/** Defined by `vite.config.ts` from `scripts/app-version.mts`. */
	const __APP_VERSION__: string;
}

export {};
