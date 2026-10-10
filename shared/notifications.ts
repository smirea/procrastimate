import { calendarDay, clockTime, relativeDay } from './format.ts';
import { fromDateKey, notificationTimes, toDateKey, type Due, type Task } from './task.ts';

/** One system notification, shown at `at` in epoch milliseconds. */
export type ScheduledNotification = { at: number; taskId: string; title: string; body: string };

/** Every future moment an open task notifies, soonest first, keeping the soonest `limit`. */
export function upcomingNotifications(tasks: readonly Task[], now: number, limit: number): ScheduledNotification[] {
	return tasks
		.filter(task => task.completedAt === null)
		.flatMap(task =>
			notificationTimes(task.due, task.reminders)
				.filter(at => at.getTime() > now)
				.map(at => ({
					at: at.getTime(),
					taskId: task.id,
					title: task.title.slice(0, 300),
					body: notificationBody(task.due, at.getTime()),
				})),
		)
		.sort((a, b) => a.at - b.at)
		.slice(0, limit);
}

/** `Due now`, `Due at 5:00 PM`, `Due Tomorrow at 5:00 PM`, `Due today`, or `Reminder`. Days are named relative to the moment it shows. */
export function notificationBody(due: Due | null, at: number): string {
	if (!due) return 'Reminder';
	const day = toDateKey(new Date(at));
	if (!due.time) return `Due ${relativeDay(due.date, day)?.toLowerCase() ?? calendarDay(due.date, day)}`;
	if (fromDateKey(due.date, due.time).getTime() === at) return 'Due now';
	const time = clockTime(due.time);
	return due.date === day
		? `Due at ${time}`
		: `Due ${relativeDay(due.date, day) ?? calendarDay(due.date, day)} at ${time}`;
}
