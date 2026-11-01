const RELOADED_AT = 'procrastimate-stale-build-reload';
/** A chunk still missing this soon after a reload is not a replaced deploy, so it fails as usual. */
const RELOAD_WINDOW_MS = 10_000;

let reloading = false;

/** Whether the page is reloading for a newer deploy, so errors from the old one are not worth reporting. */
export const reloadingForNewBuild = () => reloading;

/**
 * A deploy deletes the previous build's chunks, so a page started from an older shell (a tab's cached HTML, or a
 * service worker shell a new worker replaced mid-load) fails to import them. SvelteKit reloads on such a failure
 * during a navigation but not while hydrating the first page, which leaves it blank, so any failed chunk reloads it.
 */
export function reloadOnStaleBuild() {
	window.addEventListener('vite:preloadError', () => {
		const last = Number(sessionStorage.getItem(RELOADED_AT));
		if (Date.now() - last < RELOAD_WINDOW_MS) return;
		sessionStorage.setItem(RELOADED_AT, String(Date.now()));
		reloading = true;
		location.reload();
	});
}
