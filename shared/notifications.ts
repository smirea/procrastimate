import { z } from 'zod';
import { calendarDay, clockTime, relativeDay } from './format.ts';
import { notificationTimes, type Due, type Task } from './task.ts';
import { zonedDateKey, zonedTime } from './zoned-time.ts';

/** One system notification, shown at `at` in epoch milliseconds. */
export const scheduledNotificationSchema = z
	.object({ at: z.number(), taskId: z.string(), title: z.string(), body: z.string() })
	.meta({ id: 'ScheduledNotification' });
export type ScheduledNotification = z.infer<typeof scheduledNotificationSchema>;

/**
 * Every moment after `now` an open task notifies, soonest first, keeping the soonest `limit`. Times and bodies are
 * in `zone`, or in the process zone without one.
 */
export function upcomingNotifications(
	tasks: readonly Task[],
	now: number,
	limit: number,
	zone?: string,
): ScheduledNotification[] {
	return tasks
		.filter(task => task.completedAt === null)
		.flatMap(task =>
			notificationTimes(task.due, task.reminders, zone)
				.filter(at => at.getTime() > now)
				.map(at => ({
					at: at.getTime(),
					taskId: task.id,
					title: task.title.slice(0, 300),
					body: notificationBody(task.due, at.getTime(), zone),
				})),
		)
		.sort((a, b) => a.at - b.at)
		.slice(0, limit);
}

/** `Due now`, `Due at 5:00 PM`, `Due Tomorrow at 5:00 PM`, `Due today`, or `Reminder`. Days are named relative to the moment it shows. */
export function notificationBody(due: Due | null, at: number, zone?: string): string {
	if (!due) return 'Reminder';
	const day = zonedDateKey(at, zone);
	if (!due.time) return `Due ${relativeDay(due.date, day)?.toLowerCase() ?? calendarDay(due.date, day)}`;
	if (zonedTime(due.date, due.time, zone) === at) return 'Due now';
	const time = clockTime(due.time);
	return due.date === day
		? `Due at ${time}`
		: `Due ${relativeDay(due.date, day) ?? calendarDay(due.date, day)} at ${time}`;
}
