import type { ScheduledNotification } from '../../shared/notifications';
import { MAX_SCHEDULED, pushTag } from '../../shared/push';

/** Pushes older than this are dropped instead of delivered late. */
export const STALE_AFTER_MS = 10 * 60_000;
export const RETRY_DELAY_MS = 60_000;

export type Delivery = 'sent' | 'gone' | 'retry';

/**
 * What a device should have pending after the tasks change. `computed` is every notification the synced tasks make
 * after `now - STALE_AFTER_MS`. A future one is pending unless it was delivered. A past one stays pending only while
 * `stored` still holds it, as a retry or for an alarm that has not fired yet, so making a task due a minute ago never
 * notifies, and completing or deleting a task drops its pushes even mid-retry.
 */
export function planSchedule(
	computed: readonly ScheduledNotification[],
	stored: readonly ScheduledNotification[],
	deliveredThrough: number,
	now: number,
): ScheduledNotification[] {
	const pending = new Set(stored.map(pushTag));
	const byTag = new Map<string, ScheduledNotification>();
	for (const push of computed) {
		const tag = pushTag(push);
		if (push.at < now - STALE_AFTER_MS) continue;
		if ((push.at > now && push.at > deliveredThrough) || pending.has(tag)) byTag.set(tag, push);
	}
	return [...byTag.values()].sort((a, b) => a.at - b.at).slice(0, MAX_SCHEDULED);
}

/**
 * When the alarm should next fire for one device, or null when nothing is pending. A due push the last alarm at
 * `deliveredThrough` already tried is a retry a minute after that try. One it has not tried is due now.
 */
export function nextAlarm(
	notifications: readonly ScheduledNotification[],
	deliveredThrough: number,
	now: number,
): number | null {
	if (notifications.length === 0) return null;
	const times = notifications.map(push => {
		if (push.at > now) return push.at;
		return push.at > deliveredThrough ? now : Math.max(now, deliveredThrough + RETRY_DELAY_MS);
	});
	return Math.min(...times);
}

/** `status` is null when the request never got a response. */
export function classifyDelivery(status: number | null): Delivery {
	if (status === 404 || status === 410) return 'gone';
	if (status === null || status === 429 || status >= 500) return 'retry';
	return 'sent';
}

export const isRetryable = (push: ScheduledNotification, now: number) => push.at >= now - STALE_AFTER_MS;
