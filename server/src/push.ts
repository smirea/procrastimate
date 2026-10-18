import { ORPCError } from '@orpc/server';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { PushScheduleResponse } from '../../shared/api/contract';
import { push } from '../../shared/db/schema';
import type { Snapshot } from '../../shared/model';
import { upcomingNotifications } from '../../shared/notifications';
import { pushTag, type PushMessage, type PushSubscriptionInfo } from '../../shared/push';
import { isTimeZone } from '../../shared/zoned-time';
import type { Env } from './bindings';
import { config } from './config';
import type { Db } from './db/postgres';
import { classifyDelivery, isRetryable, nextAlarm, planSchedule, splitDue, STALE_AFTER_MS } from './push-schedule';
import { loadSpace } from './space';
import { reportError } from './sentry';
import { sendPush, type Vapid } from './web-push';

/**
 * Server-computed Web Push. After every write to a space, `replan` recomputes each subscribed install's pending
 * notifications from the space's tasks in its time zone and stores the earliest as `next_at`, which the cron selects
 * on every minute.
 */

/** Sends one push and returns the push service's status, or null when it never answered. */
export type SendPush = (subscription: PushSubscriptionInfo, message: PushMessage) => Promise<number | null>;

/** Zones are validated where they are used, since any device can write the setting. */
const FALLBACK_ZONE = 'UTC';

export const zoneOf = (snapshot: Snapshot) =>
	snapshot.settings.timeZone && isTimeZone(snapshot.settings.timeZone) ? snapshot.settings.timeZone : FALLBACK_ZONE;

/**
 * Every notification the live tasks make from ten minutes ago on. Uncapped, because `planSchedule` caps each install
 * only after dropping what it already delivered.
 */
export const computeNotifications = (snapshot: Snapshot, now: number) =>
	upcomingNotifications(snapshot.tasks, now - STALE_AFTER_MS - 1, Number.POSITIVE_INFINITY, zoneOf(snapshot));

export async function replan(db: Db, owner: string, snapshot: Snapshot, now: number): Promise<void> {
	const rows = await db.select().from(push).where(eq(push.userId, owner));
	if (!rows.length) return;
	const computed = computeNotifications(snapshot, now);
	for (const row of rows) {
		const notifications = planSchedule(computed, row.notifications, row.deliveredThrough, now);
		await db
			.update(push)
			.set({ notifications, nextAt: nextAlarm(notifications, row.deliveredThrough, now) })
			.where(and(eq(push.userId, owner), eq(push.deviceId, row.deviceId)));
	}
}

/** Push services are https. Loopback http is the end to end suite's fake push service. */
export function isAllowedEndpoint(endpoint: string) {
	const url = new URL(endpoint);
	return url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

async function send(subscription: PushSubscriptionInfo, message: PushMessage, vapid: Vapid, ttl?: number) {
	try {
		const response = await sendPush(subscription, message, vapid, ttl);
		await response.body?.cancel();
		return response.status;
	} catch (error) {
		reportError(error);
		return null;
	}
}

export function pushSender(env: Env): SendPush {
	const { vapid } = config(env);
	return (subscription, message) => send(subscription, message, vapid);
}

const TEST_MESSAGE = {
	title: 'Notifications are on',
	body: 'ProcrastiMate will notify you here when tasks are due.',
	tag: 'test',
	taskId: null,
};

export function sendTestPush(subscription: PushSubscriptionInfo, vapid: Vapid): Promise<number | null> {
	if (!isAllowedEndpoint(subscription.endpoint))
		throw new ORPCError('BAD_REQUEST', { message: 'Invalid subscription' });
	return send(subscription, TEST_MESSAGE, vapid, 300);
}

/**
 * Registers `deviceId`'s subscription. A browser that paired again as a new install replaces its old entry. The
 * endpoint must be a push service, which the shared schema cannot check.
 */
export async function subscribePush(
	db: Db,
	owner: string,
	deviceId: string,
	subscription: PushSubscriptionInfo,
	now: number,
): Promise<void> {
	if (!isAllowedEndpoint(subscription.endpoint))
		throw new ORPCError('BAD_REQUEST', { message: 'Invalid subscription' });
	await db.transaction(async tx => {
		const rows = await tx.select().from(push).where(eq(push.userId, owner));
		const current = rows.find(row => row.deviceId === deviceId);
		const replaced = rows.filter(
			row => row.deviceId !== deviceId && row.subscription.endpoint === subscription.endpoint,
		);
		for (const row of replaced) {
			await tx.delete(push).where(and(eq(push.userId, owner), eq(push.deviceId, row.deviceId)));
		}
		const kept = current?.subscription.endpoint === subscription.endpoint ? current : undefined;
		await tx
			.insert(push)
			.values({
				userId: owner,
				deviceId,
				subscription,
				notifications: kept?.notifications ?? [],
				deliveredThrough: kept?.deliveredThrough ?? now,
				nextAt: kept?.nextAt ?? null,
			})
			.onConflictDoUpdate({
				target: [push.userId, push.deviceId],
				set: {
					subscription,
					notifications: kept?.notifications ?? [],
					deliveredThrough: kept?.deliveredThrough ?? now,
					nextAt: kept?.nextAt ?? null,
				},
			});
	});
}

export async function unsubscribePush(db: Db, owner: string, deviceId: string): Promise<void> {
	await db.delete(push).where(and(eq(push.userId, owner), eq(push.deviceId, deviceId)));
}

export async function pushSchedule(db: Db, owner: string, deviceId: string): Promise<PushScheduleResponse> {
	const [row] = await db
		.select({ notifications: push.notifications })
		.from(push)
		.where(and(eq(push.userId, owner), eq(push.deviceId, deviceId)));
	return { notifications: row?.notifications ?? [] };
}

type Outcome = { endpoint: string; gone: boolean; settled: Set<string> };

/**
 * The cron, every minute: for each user with a due notification, sends each install what is due, then settles and
 * replans. A sent push, or a failed one more than ten minutes stale, is settled. A 404 or 410 drops the install's
 * subscription. The settle locks the rows, so an upload's replan landing meanwhile is not lost.
 */
export async function deliverDue(db: Db, now: number, send: SendPush): Promise<number> {
	const due = await db.selectDistinct({ owner: push.userId }).from(push).where(lte(push.nextAt, now));
	let sent = 0;
	for (const { owner } of due) {
		const rows = await db.select().from(push).where(eq(push.userId, owner));
		const outcomes = new Map<string, Outcome>();
		for (const row of rows) {
			const outcome: Outcome = { endpoint: row.subscription.endpoint, gone: false, settled: new Set() };
			outcomes.set(row.deviceId, outcome);
			for (const pending of splitDue(row.notifications, now).due) {
				if (!isRetryable(pending, now)) {
					outcome.settled.add(pushTag(pending));
					continue;
				}
				const message = { title: pending.title, body: pending.body, tag: pushTag(pending), taskId: pending.taskId };
				const delivery = classifyDelivery(await send(row.subscription, message));
				if (delivery === 'gone') {
					outcome.gone = true;
					break;
				}
				if (delivery === 'sent') {
					sent += 1;
					outcome.settled.add(pushTag(pending));
				}
			}
		}
		await db.transaction(async tx => {
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${owner}))`);
			// An upload or a new subscription can land while sends are in flight, so settle against what is stored now.
			const stored = await tx.select().from(push).where(eq(push.userId, owner));
			for (const row of stored) {
				const outcome = outcomes.get(row.deviceId);
				if (!outcome || outcome.endpoint !== row.subscription.endpoint) continue;
				const where = and(eq(push.userId, owner), eq(push.deviceId, row.deviceId));
				if (outcome.gone) {
					await tx.delete(push).where(where);
					continue;
				}
				const notifications = row.notifications.filter(pending => !outcome.settled.has(pushTag(pending)));
				await tx.update(push).set({ notifications, deliveredThrough: now }).where(where);
			}
			await replan(tx, owner, (await loadSpace(tx, owner)).snapshot, now);
		});
	}
	return sent;
}
