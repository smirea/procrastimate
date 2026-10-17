import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The deploy passes the commit as `SENTRY_RELEASE`. A local run that sets only `SENTRY_ENVIRONMENT` reports as the
 * checkout's `HEAD`, so its events still match a release. Node context only: `vite.config.ts` and the Bun dev server.
 */
export function sentryRelease(environment: string | undefined, release: string | undefined): string | undefined {
	if (release?.trim() || !environment?.trim()) return release;
	const cwd = fileURLToPath(new URL('.', import.meta.url));
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}
