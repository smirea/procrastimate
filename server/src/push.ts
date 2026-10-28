import { ORPCError } from '@orpc/server';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { PushScheduleResponse } from '../../shared/api/contract';
import { push, tasks } from '../../shared/db/schema';
import type { Task } from '../../shared/model';
import { upcomingNotifications } from '../../shared/notifications';
import { openTasks } from '../../shared/triggers';
import type { RowWrite } from '../../shared/rows';
import { pushTag, type PushMessage, type PushSubscriptionInfo } from '../../shared/push';
import type { Env } from './bindings';
import { config } from './config';
import type { Db } from './db/sqlite';
import {
	classifyDelivery,
	FRESH_SUBSCRIPTION_MS,
	isRetryable,
	nextAlarm,
	planSchedule,
	SEND_HOLD_MS,
	STALE_AFTER_MS,
} from './push-schedule';
import { reportError } from './sentry';
import { storedZone } from './space';
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

// `projectId` because a group of tasks at one moment opens the project they share.
const PUSH_FIELDS = ['due', 'reminders', 'recurrence', 'completedAt', 'event', 'location', 'projectId'];

/** Whether a write can move when a notification is due: a task created, deleted, scheduled, or completed, or the time zone. */
export function touchesPush(write: RowWrite): boolean {
	const fields = write.values ?? {};
	if (write.kind === 'settings') return write.op !== 'patch' || 'timeZone' in fields;
	if (write.kind !== 'task') return false;
	return write.op !== 'patch' || PUSH_FIELDS.some(field => field in fields);
}

type PushRow = typeof push.$inferSelect;

/**
 * Every notification the owner's open tasks make, in their time zone. A task under a completed one is set aside, so
 * the parent links are read for every task, and whole rows only for the open ones.
 */
function openNotifications(db: Db, owner: string, now: number) {
	const links = db
		.select({ id: tasks.id, parentId: tasks.parentId, completedAt: tasks.completedAt })
		.from(tasks)
		.where(eq(tasks.userId, owner))
		.all();
	const open = new Set(openTasks(links).map(t => t.id));
	const rows = db
		.select()
		.from(tasks)
		.where(and(eq(tasks.userId, owner), isNull(tasks.completedAt)))
		.all()
		.filter(row => open.has(row.id));
	return computeNotifications(rows as Task[], storedZone(db, owner), now);
}

const planOf = (computed: ReturnType<typeof computeNotifications>, row: PushRow, now: number) => {
	const notifications = planSchedule(computed, row.notifications, row.deliveredThrough, now);
	return { notifications, nextAt: nextAlarm(notifications, row.deliveredThrough, now) };
};

/** Only an owner with a subscription reads anything: then the open tasks and the time zone, nothing else. */
export function replan(db: Db, owner: string, now: number): void {
	const rows = db.select().from(push).where(eq(push.userId, owner)).all();
	if (!rows.length) return;
	const computed = openNotifications(db, owner, now);
	for (const row of rows) {
		db.update(push)
			.set(planOf(computed, row, now))
			.where(and(eq(push.userId, owner), eq(push.deviceId, row.deviceId)))
			.run();
	}
}

/**
 * The browsers' push services, so a subscription cannot point the Worker at any other host: Chrome and Edge, Apple,
 * Firefox, and Windows. Tests use a `push.example` host, which no browser hands out.
 */
const PUSH_HOSTS =
	/(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.example)$/;

export function isAllowedEndpoint(endpoint: string) {
	const url = new URL(endpoint);
	return url.protocol === 'https:' && PUSH_HOSTS.test(url.hostname);
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
	opens: null,
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
	const rows = db.select().from(push).where(eq(push.userId, owner)).all();
	const computed = openNotifications(db, owner, now);
	const current = rows.find(row => row.deviceId === deviceId);
	const replaced = rows.filter(row => row.deviceId !== deviceId && row.subscription.endpoint === subscription.endpoint);
	if (replaced.length) {
		const devices = replaced.map(row => row.deviceId);
		db.delete(push)
			.where(and(eq(push.userId, owner), inArray(push.deviceId, devices)))
			.run();
	}
	const kept = current?.subscription.endpoint === subscription.endpoint ? current : undefined;
	const stored: PushRow = {
		userId: owner,
		deviceId,
		subscription,
		notifications: kept?.notifications ?? [],
		deliveredThrough: kept?.deliveredThrough ?? now,
		subscribedAt: kept?.subscribedAt ?? now,
		nextAt: null,
	};
	const row = { ...stored, ...planOf(computed, stored, now) };
	const { userId: _, deviceId: __, ...set } = row;
	db.insert(push)
		.values(row)
		.onConflictDoUpdate({ target: [push.userId, push.deviceId], set })
		.run();
}

export async function unsubscribePush(db: Db, owner: string, deviceId: string): Promise<void> {
	db.delete(push)
		.where(and(eq(push.userId, owner), eq(push.deviceId, deviceId)))
		.run();
}

export async function pushSchedule(db: Db, owner: string, deviceId: string): Promise<PushScheduleResponse> {
	const row = db
		.select({ notifications: push.notifications })
		.from(push)
		.where(and(eq(push.userId, owner), eq(push.deviceId, deviceId)))
		.get();
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
 * subscription, unless it subscribed within `FRESH_SUBSCRIPTION_MS`, when its due pushes retry a minute later. An
 * install that subscribed within `SEND_HOLD_MS` sends nothing yet and keeps what is due for the next run. Sends await
 * the network, so other requests run meanwhile; the settle then runs with no await against the rows stored now, so a
 * write's replan that landed while sends were in flight is kept.
 */
export async function deliverDue(db: Db, now: number, send: SendPush): Promise<number> {
	const due = db.selectDistinct({ owner: push.userId }).from(push).where(lte(push.nextAt, now)).all();
	let sent = 0;
	for (const { owner } of due) {
		try {
			sent += await deliverTo(db, owner, now, send);
		} catch (error) {
			reportError(error);
		}
	}
	return sent;
}

async function deliverTo(db: Db, owner: string, now: number, send: SendPush): Promise<number> {
	let sent = 0;
	{
		const rows = db.select().from(push).where(eq(push.userId, owner)).all();
		const outcomes = new Map<string, Outcome>();
		for (const row of rows) {
			const outcome: Outcome = { endpoint: row.subscription.endpoint, gone: false, settled: new Set() };
			outcomes.set(row.deviceId, outcome);
			const held = now - row.subscribedAt < SEND_HOLD_MS;
			for (const pending of row.notifications.filter(pending => pending.at <= now)) {
				if (!isRetryable(pending, now)) {
					outcome.settled.add(pushTag(pending));
					continue;
				}
				if (held) continue;
				const message = { title: pending.title, body: pending.body, tag: pushTag(pending), opens: pending.opens };
				const delivery = classifyDelivery(await send(row.subscription, message));
				if (delivery === 'gone') {
					outcome.gone = now - row.subscribedAt >= FRESH_SUBSCRIPTION_MS;
					break;
				}
				if (delivery === 'sent') {
					sent += 1;
					outcome.settled.add(pushTag(pending));
				}
			}
		}
		// A write or a new subscription can land while sends are in flight, so settle against what is stored now.
		db.transaction(tx => {
			const stored = tx.select().from(push).where(eq(push.userId, owner)).all();
			const kept = stored.filter(row => !outcomeOf(outcomes, row)?.gone);
			const computed = kept.length ? openNotifications(tx, owner, now) : [];
			for (const row of stored) {
				const where = and(eq(push.userId, owner), eq(push.deviceId, row.deviceId));
				const outcome = outcomeOf(outcomes, row);
				if (outcome?.gone) tx.delete(push).where(where).run();
				else if (!outcome)
					tx.update(push)
						.set(planOf(computed, row, now))
						.where(where)
						.run();
				else {
					const settled = {
						...row,
						notifications: row.notifications.filter(pending => !outcome.settled.has(pushTag(pending))),
						deliveredThrough: now,
					};
					tx.update(push)
						.set({ deliveredThrough: now, ...planOf(computed, settled, now) })
						.where(where)
						.run();
				}
			}
		});
	}
	return sent;
}
