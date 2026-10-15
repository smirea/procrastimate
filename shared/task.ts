import { zonedTime } from './zoned-time.ts';

import type { Task } from './sync/protocol.ts';
import type { DateKey, Due, Recurrence, RecurrenceUnit, Reminder, TimeOfDay, Weekday } from './values.ts';

export type { DateKey, Due, Priority, Recurrence, RecurrenceUnit, Reminder, TimeOfDay, Weekday } from './values.ts';
export { DEFAULT_PRIORITY } from './values.ts';
export type { Label, Project, Section, Task } from './sync/protocol.ts';

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateKey(date: Date): DateKey {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` as DateKey;
}

export function toTimeOfDay(hours: number, minutes: number): TimeOfDay {
	return `${pad(hours)}:${pad(minutes)}` as TimeOfDay;
}

export function fromDateKey(key: DateKey, time: TimeOfDay | null = null): Date {
	const [y, m, d] = key.split('-').map(Number) as [number, number, number];
	const [h, min] = time ? (time.split(':').map(Number) as [number, number]) : [0, 0];
	return new Date(y, m - 1, d, h, min);
}

/**
 * A time set without a day of its own never lands in the past. It keeps a date still ahead, and otherwise
 * lands on the next time that clock time comes around: today, or tomorrow once it has passed.
 */
export function dueAtTime(due: Due | null, time: TimeOfDay, today: DateKey, now: TimeOfDay): Due {
	const date = due?.date ?? today;
	if (date > today || (date === today && time >= now)) return { date, time };
	return { date: time < now ? addDays(today, 1) : today, time };
}

export function addDays(key: DateKey, days: number): DateKey {
	const date = fromDateKey(key);
	date.setDate(date.getDate() + days);
	return toDateKey(date);
}

/** Clamps to the last day of a shorter month, so Jan 31 plus one month is Feb 28. */
export function addMonths(key: DateKey, months: number): DateKey {
	const [y, m, d] = key.split('-').map(Number) as [number, number, number];
	const lastDay = new Date(y, m - 1 + months + 1, 0).getDate();
	return toDateKey(new Date(y, m - 1 + months, Math.min(d, lastDay)));
}

export function addInterval(key: DateKey, interval: number, unit: RecurrenceUnit): DateKey {
	switch (unit) {
		case 'day':
			return addDays(key, interval);
		case 'weekday': {
			let date = key;
			for (let left = interval; left > 0;) {
				date = addDays(date, 1);
				if (isWeekday(date)) left--;
			}
			return date;
		}
		case 'week':
			return addDays(key, interval * 7);
		case 'month':
			return addMonths(key, interval);
		case 'year':
			return addMonths(key, interval * 12);
		default: {
			const never: never = unit;
			return never;
		}
	}
}

/**
 * When a task notifies, in order: at its due time when it has one, and at every reminder, each moment once. Times
 * are wall-clock times in `zone`, or in the process zone without one.
 */
export function notificationTimes(due: Due | null, reminders: readonly Reminder[], zone?: string): Date[] {
	const times = [
		due?.time ? new Date(zonedTime(due.date, due.time, zone)) : null,
		...reminders.map(r => reminderFiresAt(r, due, zone)),
	];
	const unique = new Map(times.filter(t => t !== null).map(t => [t.getTime(), t]));
	return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}

export function isWeekday(key: DateKey): boolean {
	const day = fromDateKey(key).getDay();
	return day !== 0 && day !== 6;
}

export const weekdayOf = (key: DateKey) => fromDateKey(key).getDay() as Weekday;

/** Monday is 0 and Sunday is 6, since weeks start on Monday. */
export const mondayIndex = (day: Weekday) => (day + 6) % 7;

/** Dedupes and sorts Monday first, the stored order of `days`. */
export function sortWeekdays(days: Iterable<Weekday>): readonly Weekday[] {
	return [...new Set(days)].toSorted((a, b) => mondayIndex(a) - mondayIndex(b));
}

/** A weekly repeat on `days`. One day is a plain weekly repeat, which follows the due date's weekday. */
export function weeklyOn(interval: number, days: Iterable<Weekday>): Recurrence {
	const sorted = sortWeekdays(days);
	return sorted.length > 1 ? { interval, unit: 'week', days: sorted } : { interval, unit: 'week' };
}

/**
 * The occurrence after `date`. A weekday set moves to the next listed day of the same week, or past
 * Sunday to the first listed day `interval` weeks after this week's Monday.
 */
export function stepRecurrence(date: DateKey, recurrence: Recurrence): DateKey {
	if (recurrence.unit !== 'week' || !recurrence.days) return addInterval(date, recurrence.interval, recurrence.unit);
	const position = mondayIndex(weekdayOf(date));
	const later = recurrence.days.find(day => mondayIndex(day) > position);
	if (later !== undefined) return addDays(date, mondayIndex(later) - position);
	return addDays(date, recurrence.interval * 7 - position + mondayIndex(recurrence.days[0]!));
}

/** The first occurrence on or after `date`: `date` itself unless a weekday set leaves it out. */
export function alignToRecurrence(date: DateKey, recurrence: Recurrence): DateKey {
	const off = recurrence.unit === 'week' && recurrence.days && !recurrence.days.includes(weekdayOf(date));
	return off ? stepRecurrence(date, { ...recurrence, interval: 1 }) : date;
}

const daysBetween = (from: DateKey, to: DateKey) =>
	Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86_400_000);

/**
 * Where a recurring task moves when it is completed: the first occurrence after today, stepping one
 * interval at a time from the due date, or from today when it has none. Each step counts from the last,
 * so a month clamped to its last day carries that day forward. Absolute reminders shift by the same
 * number of days, and relative reminders follow the due time.
 */
export function nextOccurrence(
	task: Pick<Task, 'due' | 'recurrence' | 'reminders'>,
	today: DateKey,
): { due: Due; reminders: Reminder[] } | null {
	const recurrence = task.recurrence;
	if (!recurrence) return null;
	const from = task.due?.date ?? today;
	let date = stepRecurrence(from, recurrence);
	while (date <= today) date = stepRecurrence(date, recurrence);
	const shift = daysBetween(from, date);
	return {
		due: { date, time: task.due?.time ?? null },
		reminders: task.reminders.map(r => (r.kind === 'at' ? { ...r, date: addDays(r.date, shift) } : r)),
	};
}

/** When a reminder fires, or null for a relative reminder on a task without a due time. */
export function reminderFiresAt(reminder: Reminder, due: Due | null, zone?: string): Date | null {
	switch (reminder.kind) {
		case 'at':
			return new Date(zonedTime(reminder.date, reminder.time, zone));
		case 'before': {
			if (!due?.time) return null;
			return new Date(zonedTime(due.date, due.time, zone) - reminder.minutes * 60_000);
		}
		default: {
			const never: never = reminder;
			return never;
		}
	}
}
