import { upcomingNotifications } from '../../../shared/notifications';
import { ORPCError } from '@orpc/server';
import {
	pushTag,
	type PushMessage,
	type PushScheduleResponse,
	type PushSubscriptionInfo,
	type ScheduledPush,
} from '../../../shared/push';
import { createClock, SERVER_NODE } from '../../../shared/sync/hlc';
import { entityKey, serverSnapshot } from '../../../shared/sync/merge';
import { isTimeZone } from '../../../shared/zoned-time';
import type { AccountContext } from '../auth';
import { isAllowedEndpoint } from '../push';
import { classifyDelivery, isRetryable, nextAlarm, planSchedule, splitDue, STALE_AFTER_MS } from '../push-schedule';
import type { AccountStore, PushTarget } from './store';

/**
 * Server-computed Web Push. After every push the account replans each subscribed device's pending notifications
 * from the synced tasks, in the synced time zone, and arms the object's one alarm for the earliest. The alarm
 * delivers what is due to every device, then replans.
 */

/** Sends one push and returns the push service's status, or null when it never answered. */
export type SendPush = (subscription: PushSubscriptionInfo, message: PushMessage) => Promise<number | null>;

const targets = (store: AccountStore) => store.pushTargets();

/** Zones are validated where they are used, since any device can write the setting. */
const FALLBACK_ZONE = 'UTC';

/**
 * Every notification the live tasks make from ten minutes ago on, in the account's time zone. Uncapped, because
 * `planSchedule` caps each device only after dropping what it already delivered.
 */
function computeNotifications(store: AccountStore, now: number): ScheduledPush[] {
	const entities = new Map(store.entities().map(row => [entityKey(row.kind, row.id), row]));
	const { tasks, settings } = serverSnapshot({ entities, clock: createClock(SERVER_NODE) });
	const zone = settings.timeZone && isTimeZone(settings.timeZone) ? settings.timeZone : FALLBACK_ZONE;
	return upcomingNotifications(tasks, now - STALE_AFTER_MS - 1, Number.POSITIVE_INFINITY, zone);
}

/** Replans every subscribed device against the synced tasks. Returns when the alarm should fire, or null. */
export function replan(store: AccountStore, now: number): number | null {
	return store.transaction(() => {
		const list = targets(store);
		if (!list.length) return null;
		const computed = computeNotifications(store, now);
		let alarm: number | null = null;
		for (const target of list) {
			const notifications = planSchedule(computed, target.notifications, target.deliveredThrough, now);
			store.putPushTarget({ ...target, notifications });
			const at = nextAlarm(notifications, target.deliveredThrough, now);
			if (at !== null && (alarm === null || at < alarm)) alarm = at;
		}
		return alarm;
	});
}

/** Replans and arms the alarm. */
export async function refreshPush({ store, now, setAlarm }: AccountContext) {
	await setAlarm(replan(store, now));
}

type Outcome = { endpoint: string; gone: boolean; settled: Set<string> };

/**
 * The alarm: sends each device what is due, then replans and returns when to fire next. A sent push, or a failed
 * one more than ten minutes stale, is settled. A 404 or 410 drops the device's subscription.
 */
export async function deliverDue(store: AccountStore, now: number, send: SendPush): Promise<number | null> {
	const outcomes = new Map<string, Outcome>();
	for (const target of targets(store)) {
		const outcome: Outcome = { endpoint: target.subscription.endpoint, gone: false, settled: new Set() };
		outcomes.set(target.deviceId, outcome);
		for (const push of splitDue(target.notifications, now).due) {
			if (!isRetryable(push, now)) {
				outcome.settled.add(pushTag(push));
				continue;
			}
			const message = { title: push.title, body: push.body, tag: pushTag(push), taskId: push.taskId };
			const delivery = classifyDelivery(await send(target.subscription, message));
			if (delivery === 'gone') {
				outcome.gone = true;
				break;
			}
			if (delivery === 'sent') outcome.settled.add(pushTag(push));
		}
	}
	// A sync or a new subscription can land while sends are in flight, so settle against what is stored now.
	store.transaction(() => {
		for (const target of targets(store)) {
			const outcome = outcomes.get(target.deviceId);
			if (!outcome || outcome.endpoint !== target.subscription.endpoint) continue;
			if (outcome.gone) {
				store.deletePushTarget(target.deviceId);
				continue;
			}
			const notifications = target.notifications.filter(push => !outcome.settled.has(pushTag(push)));
			store.putPushTarget({ ...target, notifications, deliveredThrough: now });
		}
	});
	return replan(store, now);
}

/**
 * Registers `deviceId`'s subscription. A browser that paired again as a new device replaces its old entry. The
 * endpoint must be a push service, which the shared schema cannot check.
 */
export async function subscribePush(context: AccountContext, deviceId: string, subscription: PushSubscriptionInfo) {
	if (!isAllowedEndpoint(subscription.endpoint))
		throw new ORPCError('BAD_REQUEST', { message: 'Invalid subscription' });
	const { store, now } = context;
	store.transaction(() => {
		let current: PushTarget | undefined;
		for (const target of targets(store)) {
			if (target.deviceId === deviceId) current = target;
			else if (target.subscription.endpoint === subscription.endpoint) store.deletePushTarget(target.deviceId);
		}
		const kept = current?.subscription.endpoint === subscription.endpoint ? current : undefined;
		store.putPushTarget({
			deviceId,
			subscription,
			notifications: kept?.notifications ?? [],
			deliveredThrough: kept?.deliveredThrough ?? now,
		});
	});
	await refreshPush(context);
}

export async function unsubscribePush(context: AccountContext, deviceId: string) {
	context.store.deletePushTarget(deviceId);
	await refreshPush(context);
}

export function pushSchedule(store: AccountStore, deviceId: string): PushScheduleResponse {
	const target = targets(store).find(target => target.deviceId === deviceId);
	return { notifications: target?.notifications ?? [] };
}
