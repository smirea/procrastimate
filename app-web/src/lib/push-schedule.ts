import { MAX_SCHEDULED, type ScheduledPush } from 'shared/push.ts';
import { fromDateKey, notificationTimes, toDateKey, type Task } from 'shared/task.ts';
import { calendarDay, clockTime, relativeDay } from './format.ts';

/** Every future moment an incomplete task notifies, soonest first, as the server should deliver them. */
export function pushSchedule(tasks: readonly Task[], now: number): ScheduledPush[] {
	return tasks
		.filter(task => task.completedAt === null)
		.flatMap(task =>
			notificationTimes(task.due, task.reminders)
				.filter(at => at.getTime() > now)
				.map(at => ({ at: at.getTime(), taskId: task.id, title: task.title.slice(0, 300), body: body(task, at) })),
		)
		.sort((a, b) => a.at - b.at)
		.slice(0, MAX_SCHEDULED);
}

/** Days are named relative to the moment the notification shows, not to when it was scheduled. */
function body({ due }: Task, at: Date): string {
	if (!due) return 'Reminder';
	const day = toDateKey(at);
	if (!due.time) return `Due ${relativeDay(due.date, day)?.toLowerCase() ?? calendarDay(due.date, day)}`;
	if (fromDateKey(due.date, due.time).getTime() === at.getTime()) return 'Due now';
	const time = clockTime(due.time);
	return due.date === day
		? `Due at ${time}`
		: `Due ${relativeDay(due.date, day) ?? calendarDay(due.date, day)} at ${time}`;
}
