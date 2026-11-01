import { initSentry } from '#lib/sentry.ts';
import { reloadOnStaleBuild } from '#lib/stale-build.ts';

initSentry();
reloadOnStaleBuild();

export { handleError } from '#lib/sentry.ts';
