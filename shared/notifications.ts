import { z } from 'zod';
import { calendarDay, clockTime, relativeDay } from './format.ts';
import type { DateKey, Due, Task } from './task.ts';
import { formatEvent, openTasks, placeKey, scheduledDue, taskNotificationTimes } from './triggers.ts';
import { zonedDateKey } from './zoned-time.ts';

export const notificationTargetKindSchema = z
	.enum(['task', 'place', 'event', 'project', 'inbox'])
	.meta({ id: 'NotificationTargetKind' });

export const notificationTargetSchema = z.object({ kind: notificationTargetKindSchema, id: z.string() }).meta({
	id: 'NotificationTarget',
	description:
		"What tapping a notification opens: a task's details, or the list its tasks share. `id` is empty for Inbox.",
});
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export const scheduledNotificationSchema = z
	.object({
		at: z.number().meta({ description: 'When it shows, in epoch milliseconds.', 'x-epoch-ms': true }),
		title: z.string(),
		body: z.string(),
		opens: notificationTargetSchema,
	})
	.meta({ id: 'ScheduledNotification' });
export type ScheduledNotification = z.infer<typeof scheduledNotificationSchema>;

/**
 * Every moment after `now` an open task notifies, soonest first, keeping the soonest `limit`. Tasks that notify at the
 * same moment share one notification. Times and bodies are in `zone`, or in the process zone without one.
 */
export function upcomingNotifications(
	tasks: readonly Task[],
	now: number,
	limit: number,
	zone?: string,
): ScheduledNotification[] {
	const today = zonedDateKey(now, zone);
	const firing = new Map<number, Task[]>();
	for (const task of openTasks(tasks)) {
		for (const time of taskNotificationTimes(task, today, zone)) {
			const at = time.getTime();
			if (at > now) firing.set(at, [...(firing.get(at) ?? []), task]);
		}
	}
	return [...firing]
		.sort(([a], [b]) => a - b)
		.slice(0, limit)
		.map(([at, tasks]) => momentNotification(tasks, at, today, zone));
}

/**
 * Everything that notified in (`since`, `now`] as one notification at the latest moment, or null: the open app's catch
 * up after the window, which can span a closed tab's days, so it never shows one per moment.
 */
export function caughtUpNotification(
	tasks: readonly Task[],
	since: number,
	now: number,
	zone?: string,
): ScheduledNotification | null {
	const today = zonedDateKey(now, zone);
	let latest = 0;
	const fired = openTasks(tasks).filter(task => {
		const times = taskNotificationTimes(task, today, zone)
			.map(t => t.getTime())
			.filter(at => at > since && at <= now);
		latest = Math.max(latest, ...times);
		return times.length > 0;
	});
	return fired.length ? momentNotification(fired, latest, today, zone) : null;
}

const MAX_TEXT = 300;
const LISTED = 3;

/**
 * One task as itself, opening its details. Several as their count and first titles, opening the list they all share:
 * their event, their place, their project, or else Inbox.
 */
function momentNotification(tasks: readonly Task[], at: number, today: DateKey, zone?: string): ScheduledNotification {
	const [first, ...rest] = tasks;
	if (!first) throw new Error('A notification needs a task');
	if (!rest.length)
		return {
			at,
			title: first.title.slice(0, MAX_TEXT),
			body: taskNotificationBody(first, at, today, zone),
			opens: { kind: 'task', id: first.id },
		};
	const opens = sharedList(tasks);
	const name =
		opens.kind === 'event' ? ` for ${first.event?.title}` : opens.kind === 'place' ? ` at ${first.location?.name}` : '';
	return {
		at,
		title: `${tasks.length} tasks${name}`.slice(0, MAX_TEXT),
		body: titleList(tasks.map(t => t.title)),
		opens,
	};
}

function sharedList(tasks: readonly Task[]): NotificationTarget {
	const shared = (key: (task: Task) => string | null) => {
		const keys = new Set(tasks.map(key));
		const [only] = keys;
		return keys.size === 1 && only ? only : null;
	};
	const event = shared(t => t.event?.id ?? null);
	if (event) return { kind: 'event', id: event };
	const place = shared(t => (t.location ? placeKey(t.location) : null));
	if (place) return { kind: 'place', id: place };
	const project = shared(t => t.projectId);
	if (project) return { kind: 'project', id: project };
	return { kind: 'inbox', id: '' };
}

/** `Gym, Rent, Taxes`, or `Gym, Rent, Taxes, and 2 more` past three. */
function titleList(titles: readonly string[]): string {
	const listed = titles.slice(0, LISTED).join(', ');
	const more = titles.length - LISTED;
	return (more > 0 ? `${listed}, and ${more} more` : listed).slice(0, MAX_TEXT);
}

/** An event task names its event; any other names its due day and time. */
export function taskNotificationBody(task: Task, at: number, today: DateKey, zone?: string): string {
	return task.event ? formatEvent(task.event) : notificationBody(scheduledDue(task, today, zone), at, zone);
}

/** The due day and time, such as `Today 3:00 PM` or `Tue Oct 20`, with days named relative to the moment it shows. */
export function notificationBody(due: Due | null, at: number, zone?: string): string {
	if (!due) return 'Reminder';
	const today = zonedDateKey(at, zone);
	const day = relativeDay(due.date, today) ?? calendarDay(due.date, today);
	return due.time ? `${day} ${clockTime(due.time)}` : day;
}
