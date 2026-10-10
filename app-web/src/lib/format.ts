import {
	addDays,
	fromDateKey,
	type DateKey,
	type Due,
	type Priority,
	type Reminder,
	type TimeOfDay,
} from 'shared/task.ts';

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';

export const PRIORITIES: Record<Priority, { label: string; tone: string }> = {
	1: { label: 'Priority 1', tone: 'var(--p1)' },
	2: { label: 'Priority 2', tone: 'var(--p2)' },
	3: { label: 'Priority 3', tone: 'var(--p3)' },
	4: { label: 'Priority 4', tone: 'var(--p4)' },
};

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
