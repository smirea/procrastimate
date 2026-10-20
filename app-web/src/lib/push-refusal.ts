const BACKOFF_MS = 24 * 60 * 60 * 1000;

/**
 * Chrome answers `AbortError: Registration failed - push service error` when its push service will not register the
 * browser, which no retry from the page fixes. Launches and tab switches then wait a day before asking again, instead
 * of failing and reporting on each one.
 */
export const isPushRefusal = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Whether a refusal stored at `refusedAt` (epoch ms as a string, or null when none) still holds at `now`. */
export const refusedRecently = (refusedAt: string | null, now: number) =>
	refusedAt !== null && now - Number(refusedAt) < BACKOFF_MS;

/** A refusal whose day has passed, which is the moment to ask once more. */
export const refusalOver = (refusedAt: string | null, now: number) =>
	refusedAt !== null && !refusedRecently(refusedAt, now);
