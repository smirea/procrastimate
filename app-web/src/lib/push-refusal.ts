import { DEVICE_KEYS } from './device.ts';

const BACKOFF_MS = 24 * 60 * 60 * 1000;
const REFUSED_KEY = DEVICE_KEYS.pushRefusedAt;

/**
 * Chrome answers `AbortError: Registration failed - push service error` when its push service will not register the
 * browser, which no retry from the page fixes. Launches and tab switches then wait a day before asking again, instead
 * of failing and reporting on each one.
 */
const isPushRefusal = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Whether a refusal stored at `refusedAt` (epoch ms as a string, or null when none) still holds at `now`. */
export const refusedRecently = (refusedAt: string | null, now: number) =>
	refusedAt !== null && now - Number(refusedAt) < BACKOFF_MS;

/** A refusal whose day has passed, which is the moment to ask once more. */
export const refusalOver = (refusedAt: string | null, now: number) =>
	refusedAt !== null && !refusedRecently(refusedAt, now);

/**
 * A new subscription, or `refused` when the push service turned the browser away. A refusal is the browser's state,
 * not a fault of the app, so it is noted for the backoff and never reported. Any other failure throws.
 */
export async function subscribe(
	registration: Pick<ServiceWorkerRegistration, 'pushManager'>,
	key: Uint8Array<ArrayBuffer>,
	storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
	now = Date.now(),
): Promise<PushSubscription | 'refused'> {
	try {
		const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
		storage.removeItem(REFUSED_KEY);
		return subscription;
	} catch (error) {
		if (!isPushRefusal(error)) throw error;
		storage.setItem(REFUSED_KEY, String(now));
		return 'refused';
	}
}
