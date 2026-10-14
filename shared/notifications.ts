import { z } from 'zod';
import { calendarDay, clockTime, relativeDay } from './format.ts';
import type { Due, Task } from './task.ts';
import { formatEvent, scheduledDue, taskNotificationTimes } from './triggers.ts';
import { zonedDateKey, zonedTime } from './zoned-time.ts';

export const scheduledNotificationSchema = z
	.object({
		at: z.number().meta({ description: 'When it shows, in epoch milliseconds.', 'x-epoch-ms': true }),
		taskId: z.string(),
		title: z.string(),
		body: z.string(),
	})
	.meta({ id: 'ScheduledNotification' });
export type ScheduledNotification = z.infer<typeof scheduledNotificationSchema>;

/**
 * Every moment after `now` an open task notifies, soonest first, with an event task's body naming its event, keeping the soonest `limit`. Times and bodies are
 * in `zone`, or in the process zone without one.
 */
export function upcomingNotifications(
	tasks: readonly Task[],
	now: number,
	limit: number,
	zone?: string,
): ScheduledNotification[] {
	const today = zonedDateKey(now, zone);
	return tasks
		.filter(task => task.completedAt === null)
		.flatMap(task =>
			taskNotificationTimes(task, today, zone)
				.filter(at => at.getTime() > now)
				.map(at => ({
					at: at.getTime(),
					taskId: task.id,
					title: task.title.slice(0, 300),
					body: task.event
						? formatEvent(task.event)
						: notificationBody(scheduledDue(task, today, zone), at.getTime(), zone),
				})),
		)
		.sort((a, b) => a.at - b.at)
		.slice(0, limit);
}

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
