import { z } from 'zod';
import { calendarDay, clockTime, relativeDay } from './format.ts';
import type { DateKey, Due, Task } from './task.ts';
import { formatEvent, scheduledDue, taskNotificationTimes } from './triggers.ts';
import { zonedDateKey } from './zoned-time.ts';

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
					body: taskNotificationBody(task, at.getTime(), today, zone),
				})),
		)
		.sort((a, b) => a.at - b.at)
		.slice(0, limit);
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
