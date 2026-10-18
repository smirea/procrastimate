import { ORPCError } from '@orpc/server';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { PushScheduleResponse } from '../../shared/api/contract';
import { push, tasks } from '../../shared/db/schema';
import type { Task } from '../../shared/model';
import { upcomingNotifications } from '../../shared/notifications';
import type { RowWrite } from '../../shared/rows';
import { pushTag, type PushMessage, type PushSubscriptionInfo } from '../../shared/push';
import type { Env } from './bindings';
import { config } from './config';
import type { Db } from './db/postgres';
import { classifyDelivery, isRetryable, nextAlarm, planSchedule, splitDue, STALE_AFTER_MS } from './push-schedule';
import { reportError } from './sentry';
import { storedZone, withSpaceLocked } from './space';
import { sendPush, type Vapid } from './web-push';

/**
 * Server-computed Web Push. After a write that moves when a notification is due, `replan` recomputes each subscribed
 * install's pending notifications from the space's open tasks in its time zone and stores the earliest as `next_at`,
 * which the cron selects on every minute.
 */

/** Sends one push and returns the push service's status, or null when it never answered. */
export type SendPush = (subscription: PushSubscriptionInfo, message: PushMessage) => Promise<number | null>;

/**
 * Every notification the open tasks make from ten minutes ago on. Uncapped, because `planSchedule` caps each install
 * only after dropping what it already delivered.
 */
export const computeNotifications = (open: readonly Task[], zone: string, now: number) =>
	upcomingNotifications(open, now - STALE_AFTER_MS - 1, Number.POSITIVE_INFINITY, zone);

const PUSH_FIELDS = ['due', 'reminders', 'recurrence', 'completedAt', 'event', 'location'];

/** Whether a write can move when a notification is due: a task created, deleted, scheduled, or completed, or the time zone. */
export function touchesPush(write: RowWrite): boolean {
	const fields = write.values ?? {};
	if (write.kind === 'settings') return write.op !== 'patch' || 'timeZone' in fields;
	if (write.kind !== 'task') return false;
	return write.op !== 'patch' || PUSH_FIELDS.some(field => field in fields);
}

type PushRow = typeof push.$inferSelect;

/** Every notification the owner's open tasks make, in their time zone: the two reads a plan needs. */
async function openNotifications(db: Db, owner: string, now: number) {
	const [open, zone] = await Promise.all([
		db
			.select()
			.from(tasks)
			.where(and(eq(tasks.userId, owner), isNull(tasks.completedAt))),
		storedZone(db, owner),
	]);
	return computeNotifications(open as Task[], zone, now);
}

const planOf = (computed: ReturnType<typeof computeNotifications>, row: PushRow, now: number) => {
	const notifications = planSchedule(computed, row.notifications, row.deliveredThrough, now);
	return { notifications, nextAt: nextAlarm(notifications, row.deliveredThrough, now) };
};

/** Only an owner with a subscription reads anything: then the open tasks and the time zone, nothing else. */
export async function replan(db: Db, owner: string, now: number): Promise<void> {
	const rows = await db.select().from(push).where(eq(push.userId, owner));
	if (!rows.length) return;
	const computed = await openNotifications(db, owner, now);
	await Promise.all(
		rows.map(row =>
			db
				.update(push)
				.set(planOf(computed, row, now))
				.where(and(eq(push.userId, owner), eq(push.deviceId, row.deviceId))),
		),
	);
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
	// Planned at once: the cron only selects rows with a `nextAt`, so a subscription that waited for the next write
	// would miss every reminder already due before then.
	const [rows, computed] = await Promise.all([
		db.select().from(push).where(eq(push.userId, owner)),
		openNotifications(db, owner, now),
	]);
	const current = rows.find(row => row.deviceId === deviceId);
	const replaced = rows.filter(row => row.deviceId !== deviceId && row.subscription.endpoint === subscription.endpoint);
	if (replaced.length) {
		const devices = replaced.map(row => row.deviceId);
		await db.delete(push).where(and(eq(push.userId, owner), inArray(push.deviceId, devices)));
	}
	const kept = current?.subscription.endpoint === subscription.endpoint ? current : undefined;
	const stored: PushRow = {
		userId: owner,
		deviceId,
		subscription,
		notifications: kept?.notifications ?? [],
		deliveredThrough: kept?.deliveredThrough ?? now,
		nextAt: null,
	};
	const row = { ...stored, ...planOf(computed, stored, now) };
	const { userId: _, deviceId: __, ...set } = row;
	await db
		.insert(push)
		.values(row)
		.onConflictDoUpdate({ target: [push.userId, push.deviceId], set });
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

/** What this run did for an install, unless it has since subscribed again with another endpoint. */
function outcomeOf(outcomes: ReadonlyMap<string, Outcome>, row: PushRow): Outcome | undefined {
	const outcome = outcomes.get(row.deviceId);
	return outcome?.endpoint === row.subscription.endpoint ? outcome : undefined;
}

/**
 * The cron, every minute: for each user with a due notification, sends each install what is due, then settles and
 * replans. A sent push, or a failed one more than ten minutes stale, is settled. A 404 or 410 drops the install's
 * subscription. The settle runs under the space's lock against the rows stored now, so an upload's replan that landed
 * while sends were in flight is kept; a replan that read before the settle and lands after it can bring a sent
 * notification back for one more send, which the OS replaces by its tag.
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
		await withSpaceLocked(db, owner, async tx => {
			// An upload or a new subscription can land while sends are in flight, so settle against what is stored now.
			const stored = await tx.select().from(push).where(eq(push.userId, owner));
			const kept = stored.filter(row => !outcomeOf(outcomes, row)?.gone);
			const computed = kept.length ? await openNotifications(tx, owner, now) : [];
			await Promise.all(
				stored.map(row => {
					const where = and(eq(push.userId, owner), eq(push.deviceId, row.deviceId));
					const outcome = outcomeOf(outcomes, row);
					if (outcome?.gone) return tx.delete(push).where(where);
					if (!outcome)
						return tx
							.update(push)
							.set(planOf(computed, row, now))
							.where(where);
					const settled = {
						...row,
						notifications: row.notifications.filter(pending => !outcome.settled.has(pushTag(pending))),
						deliveredThrough: now,
					};
					return tx
						.update(push)
						.set({ deliveredThrough: now, ...planOf(computed, settled, now) })
						.where(where);
				}),
			);
		});
	}
	return sent;
}
