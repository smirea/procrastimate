import { upcomingNotifications } from 'shared/notifications.ts';
import { MAX_SCHEDULED, type ScheduledPush } from 'shared/push.ts';
import type { Task } from 'shared/task.ts';

/** Every future moment an incomplete task notifies, soonest first, as the server should deliver them. */
export const pushSchedule = (tasks: readonly Task[], now: number): ScheduledPush[] =>
	upcomingNotifications(tasks, now, MAX_SCHEDULED);
