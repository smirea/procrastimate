import { MAX_SCHEDULED, pushTag, type ScheduledPush } from '../../shared/push';

/** Pushes older than this are dropped instead of delivered late. */
export const STALE_AFTER_MS = 10 * 60_000;
export const RETRY_DELAY_MS = 60_000;

/** How a push service response settles one scheduled push. */
export type Delivery = 'sent' | 'gone' | 'retry';

/** The schedule a device should hold after it uploads `incoming`. */
export function planSchedule(incoming: ScheduledPush[], deliveredThrough: number, now: number): ScheduledPush[] {
	const byTag = new Map<string, ScheduledPush>();
	for (const push of incoming) {
		if (push.at > deliveredThrough && push.at >= now - STALE_AFTER_MS) byTag.set(pushTag(push), push);
	}
	return [...byTag.values()].sort((a, b) => a.at - b.at).slice(0, MAX_SCHEDULED);
}

export function splitDue(notifications: ScheduledPush[], now: number) {
	return {
		due: notifications.filter(push => push.at <= now),
		pending: notifications.filter(push => push.at > now),
	};
}

/** When the alarm should next fire, or null when nothing is scheduled. Overdue pushes are retries. */
export function nextAlarm(notifications: ScheduledPush[], now: number): number | null {
	if (notifications.length === 0) return null;
	const earliest = Math.min(...notifications.map(push => push.at));
	return earliest <= now ? now + RETRY_DELAY_MS : earliest;
}

/** `status` is null when the request never got a response. */
export function classifyDelivery(status: number | null): Delivery {
	if (status === 404 || status === 410) return 'gone';
	if (status === null || status === 429 || status >= 500) return 'retry';
	return 'sent';
}

export const isRetryable = (push: ScheduledPush, now: number) => push.at >= now - STALE_AFTER_MS;
