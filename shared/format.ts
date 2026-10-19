import { z } from 'zod';
import {
	addDays,
	fromDateKey,
	toDateKey,
	toTimeOfDay,
	weekdayOf,
	type DateKey,
	type Due,
	type Priority,
	type Recurrence,
	type Reminder,
	type TimeOfDay,
} from './task.ts';
import { dateKeySchema } from './values.ts';
import type { CompletedRange } from './views.ts';

export const dueToneSchema = z.enum(['overdue', 'today', 'soon', 'week', 'later']).meta({ id: 'DueTone' });
export type DueTone = z.infer<typeof dueToneSchema>;

export const priorityLabel = (priority: Priority) => `Priority ${priority}`;

export function formatTime(time: TimeOfDay): string {
	const [h, m] = time.split(':').map(Number) as [number, number];
	const suffix = h < 12 ? 'am' : 'pm';
	const hour = h % 12 || 12;
	return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatDate(date: DateKey, today: DateKey): string {
	return relativeDay(date, today) ?? weekdayWithinWeek(date, today) ?? shortDate(date, today);
}

/** `Friday` for a day in the coming week, which a weekday name alone tells apart. */
function weekdayWithinWeek(date: DateKey, today: DateKey): string | null {
	if (date > today && date < addDays(today, 7))
		return fromDateKey(date).toLocaleDateString('en-US', { weekday: 'long' });
	return null;
}

/** `Oct 21`, with the year when it differs from today's. */
export function shortDate(date: DateKey, today: DateKey): string {
	const sameYear = date.slice(0, 4) === today.slice(0, 4);
	return fromDateKey(date).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: sameYear ? undefined : 'numeric',
	});
}

export function formatDue(due: Due, today: DateKey): string {
	const date = formatDate(due.date, today);
	return due.time ? `${date} ${formatTime(due.time)}` : date;
}

/** Red overdue, orange today, green through 3 days out, purple through a week, then gray. */
export function dueTone(due: Due, today: DateKey): DueTone {
	if (due.date < today) return 'overdue';
	if (due.date === today) return 'today';
	if (due.date <= addDays(today, 3)) return 'soon';
	if (due.date <= addDays(today, 7)) return 'week';
	return 'later';
}

export function formatMinutes(minutes: number): string {
	if (minutes % 1440 === 0) return `${minutes / 1440}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function formatRecurrence(recurrence: Recurrence, due: Due | null): string {
	const { interval, unit } = recurrence;
	const days = unit === 'week' ? (recurrence.days ?? (due && interval === 1 ? [weekdayOf(due.date)] : null)) : null;
	if (days) {
		const names = days.map(day => WEEKDAY_NAMES[day]).join(', ');
		return interval === 1 ? `Every ${names}` : `Every ${interval} weeks on ${names}`;
	}
	const every = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
	if (unit !== 'month') return every;
	if (recurrence.nth) {
		const { week, weekday } = recurrence.nth;
		return `${every} on the ${week === -1 ? 'last' : ordinal(week)} ${WEEKDAY_NAMES[weekday]}`;
	}
	return recurrence.day ? `${every} on the ${ordinal(recurrence.day)}` : every;
}

/** `1st`, `2nd`, `11th`, `22nd`. */
export function ordinal(n: number): string {
	const teen = n % 100 >= 11 && n % 100 <= 13;
	return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

export function repeatLabel(recurrence: Recurrence, due: Due | null): string {
	const repeat = formatRecurrence(recurrence, due);
	return `Repeats ${repeat[0]!.toLowerCase()}${repeat.slice(1)}`;
}

export function clockTime(time: TimeOfDay): string {
	const [h, m] = time.split(':').map(Number) as [number, number];
	return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `Sat Oct 17`, with the year only when it is not this year. */
export function calendarDay(date: DateKey, today: DateKey): string {
	const d = fromDateKey(date);
	const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
	const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	return date.slice(0, 4) === today.slice(0, 4) ? `${weekday} ${day}` : `${weekday} ${day}, ${date.slice(0, 4)}`;
}

export function relativeDay(date: DateKey, today: DateKey): string | null {
	if (date === today) return 'Today';
	if (date === addDays(today, 1)) return 'Tomorrow';
	return date === addDays(today, -1) ? 'Yesterday' : null;
}

/** How long ago a task was added: `Today`, `Yesterday`, `3 days ago`, `2 weeks ago`, `5 months ago`, `1 year ago`. */
export function addedAgo(added: DateKey, today: DateKey): string {
	const days = Math.round((Date.parse(today) - Date.parse(added)) / 86_400_000);
	if (days <= 0) return 'Today';
	if (days === 1) return 'Yesterday';
	const [count, unit] =
		days < 7
			? [days, 'day']
			: days < 30
				? [Math.floor(days / 7), 'week']
				: days < 365
					? [Math.floor(days / 30), 'month']
					: [Math.floor(days / 365), 'year'];
	return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function formatReminder(reminder: Reminder, today: DateKey): string {
	switch (reminder.kind) {
		case 'before':
			return reminder.minutes === 0 ? 'At due time' : `${formatMinutes(reminder.minutes)} before`;
		case 'at':
			return `${formatDate(reminder.date, today)} ${formatTime(reminder.time)}`;
		default: {
			const never: never = reminder;
			return never;
		}
	}
}

/** A day heading in Inbox with only what today leaves ambiguous: `Tomorrow`, `Friday` within the week, then `Tue, Oct 31`, with the year when it differs. */
export function dayHeading(date: DateKey, today: DateKey): string {
	if (date === addDays(today, 1)) return 'Tomorrow';
	return weekdayWithinWeek(date, today) ?? weekdayAndDate(date, today);
}

/** `Tue, Oct 31`, with the year when it differs. */
const weekdayAndDate = (date: DateKey, today: DateKey) =>
	`${WEEKDAY_NAMES[weekdayOf(date)]}, ${shortDate(date, today)}`;

/** When a task was completed, in local time: `Today 3:04pm`, `Yesterday 9am`, `Oct 12 3:04pm`. */
export function completedWhen(at: number, today: DateKey): string {
	const date = new Date(at);
	return formatDue({ date: toDateKey(date), time: toTimeOfDay(date.getHours(), date.getMinutes()) }, today);
}

/** A day heading in the Completed view: `Today`, `Yesterday`, then `Mon, Oct 12`, with the year when it differs. */
export function completedHeading(date: DateKey, today: DateKey): string {
	if (date === addDays(today, 1)) return weekdayAndDate(date, today);
	return relativeDay(date, today) ?? weekdayAndDate(date, today);
}

/** `Today`, `Last 7 days`, `Last 30 days`, `All time`, or the custom days, such as `Oct 1 – Oct 12`. */
export function completedRangeLabel(range: CompletedRange, today: DateKey): string {
	const { from, to } = range;
	if (from === null && to === null) return 'All time';
	if (to === today && from === today) return 'Today';
	if (to === today && from === addDays(today, -6)) return 'Last 7 days';
	if (to === today && from === addDays(today, -29)) return 'Last 30 days';
	if (from === null) return `Until ${shortDate(to!, today)}`;
	if (to === null) return `Since ${shortDate(from, today)}`;
	return from === to ? shortDate(from, today) : `${shortDate(from, today)} – ${shortDate(to, today)}`;
}

export const reopenedToast = (title: string) => `Reopened “${title}”`;

export function completedToast(title: string, next: Due | null, today: DateKey): string {
	return next ? `Completed “${title}”, next due ${formatDue(next, today)}` : `Completed “${title}”`;
}

export const postponeOptionSchema = z.object({ label: z.string(), date: dateKeySchema }).meta({ id: 'PostponeOption' });
export type PostponeOption = z.infer<typeof postponeOptionSchema>;

/**
 * The days a task can be pushed to, like Todoist's: `Today` for an overdue or undated task, `Tomorrow`, the coming
 * Saturday, and the coming Monday. A day the task is already on, or that an earlier option names, is left out.
 */
export function postponeOptions(due: Due | null, today: DateKey): PostponeOption[] {
	const weekday = weekdayOf(today);
	const weekend = weekday === 0 || weekday === 6;
	const options: PostponeOption[] = [
		...(due === null || due.date < today ? [{ label: 'Today', date: today }] : []),
		{ label: 'Tomorrow', date: addDays(today, 1) },
		{ label: weekend ? 'Next weekend' : 'This weekend', date: addDays(today, (6 - weekday + 7) % 7 || 7) },
		{ label: 'Next week', date: addDays(today, (1 - weekday + 7) % 7 || 7) },
	];
	return options.filter((o, i) => o.date !== due?.date && options.findIndex(p => p.date === o.date) === i);
}
