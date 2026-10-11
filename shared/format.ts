import {
	addDays,
	fromDateKey,
	weekdayOf,
	type DateKey,
	type Due,
	type Priority,
	type Recurrence,
	type Reminder,
	type TimeOfDay,
} from './task.ts';

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

export const priorityLabel = (priority: Priority) => `Priority ${priority}`;

export function formatTime(time: TimeOfDay): string {
	const [h, m] = time.split(':').map(Number) as [number, number];
	const suffix = h < 12 ? 'am' : 'pm';
	const hour = h % 12 || 12;
	return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatDate(date: DateKey, today: DateKey): string {
	if (date === today) return 'Today';
	if (date === addDays(today, 1)) return 'Tomorrow';
	if (date === addDays(today, -1)) return 'Yesterday';
	const d = fromDateKey(date);
	if (date > today && date < addDays(today, 7)) return d.toLocaleDateString('en-US', { weekday: 'long' });
	const sameYear = date.slice(0, 4) === today.slice(0, 4);
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

export function formatDue(due: Due, today: DateKey): string {
	const date = formatDate(due.date, today);
	return due.time ? `${date} ${formatTime(due.time)}` : date;
}

export function dueTone(due: Due, today: DateKey): DueTone {
	if (due.date < today) return 'overdue';
	if (due.date === today) return 'today';
	if (due.date === addDays(today, 1)) return 'tomorrow';
	if (due.date < addDays(today, 7)) return 'week';
	return 'later';
}

export function formatMinutes(minutes: number): string {
	if (minutes % 1440 === 0) return `${minutes / 1440}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** `Every Mon`, `Every Mon, Wed, Fri`, `Every 2 weeks on Tue, Thu`, `Every 3 days`. */
export function formatRecurrence(recurrence: Recurrence, due: Due | null): string {
	const { interval, unit } = recurrence;
	const days = unit === 'week' ? (recurrence.days ?? (due && interval === 1 ? [weekdayOf(due.date)] : null)) : null;
	if (days) {
		const names = days.map(day => WEEKDAY_NAMES[day]).join(', ');
		return interval === 1 ? `Every ${names}` : `Every ${interval} weeks on ${names}`;
	}
	return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

/** `Repeats every Mon`. */
export function repeatLabel(recurrence: Recurrence, due: Due | null): string {
	const repeat = formatRecurrence(recurrence, due);
	return `Repeats ${repeat[0]!.toLowerCase()}${repeat.slice(1)}`;
}

/** `5:00 PM`, spelled out because `toLocaleTimeString` inserts a narrow no-break space on newer ICU. */
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

export function dayHeading(date: DateKey, today: DateKey): string {
	const d = fromDateKey(date);
	const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
	return date === addDays(today, 1) ? `${label} · Tomorrow · ${weekday}` : `${label} · ${weekday}`;
}

/** The undo toast after completing a task: `Completed “Standup”`, or `…, next due Friday 9am` when it repeats. */
export function completedToast(title: string, next: Due | null, today: DateKey): string {
	return next ? `Completed “${title}”, next due ${formatDue(next, today)}` : `Completed “${title}”`;
}

/** The toast an open app shows when a task's due time or reminder comes up. */
export const reminderToast = (title: string) => `Reminder: ${title}`;
