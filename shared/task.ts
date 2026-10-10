/** Local calendar date, `YYYY-MM-DD`. */
export type DateKey = `${number}-${number}-${number}`;
/** Local wall-clock time, `HH:mm`. */
export type TimeOfDay = `${number}:${number}`;

/** Todoist priorities: 1 is the most urgent, 4 is the unmarked default. */
export type Priority = 1 | 2 | 3 | 4;
export const DEFAULT_PRIORITY: Priority = 4;

export type Due = { date: DateKey; time: TimeOfDay | null };

export type Reminder = { kind: 'before'; minutes: number } | { kind: 'at'; date: DateKey; time: TimeOfDay };

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

/** Repeats every `interval` units, counted from the due date. A weekly repeat keeps the due date's weekday. */
export type Recurrence = { interval: number; unit: RecurrenceUnit };

export type Task = {
	id: string;
	title: string;
	notes: string;
	projectId: string | null;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority;
	reminders: Reminder[];
	createdAt: number;
	completedAt: number | null;
};

export type Project = { id: string; name: string; createdAt: number };

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

/** When a reminder fires, or null for a relative reminder on a task without a due time. */
export function reminderFiresAt(reminder: Reminder, due: Due | null): Date | null {
	switch (reminder.kind) {
		case 'at':
			return fromDateKey(reminder.date, reminder.time);
		case 'before': {
			if (!due?.time) return null;
			return new Date(fromDateKey(due.date, due.time).getTime() - reminder.minutes * 60_000);
		}
		default: {
			const never: never = reminder;
			return never;
		}
	}
}
