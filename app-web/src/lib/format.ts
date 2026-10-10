import {
	addDays,
	fromDateKey,
	reminderFiresAt,
	toDateKey,
	toTimeOfDay,
	type DateKey,
	type Due,
	type Priority,
	type Recurrence,
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

export function formatRecurrence({ interval, unit }: Recurrence, due: Due | null): string {
	if (unit === 'week' && interval === 1 && due) {
		return `Every ${fromDateKey(due.date).toLocaleDateString('en-US', { weekday: 'short' })}`;
	}
	return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

/** `Repeats every Mon`. */
export function repeatLabel(recurrence: Recurrence, due: Due | null): string {
	const repeat = formatRecurrence(recurrence, due);
	return `Repeats ${repeat[0]!.toLowerCase()}${repeat.slice(1)}`;
}

export type TimingSegment = { kind: 'due' | 'recurrence' | 'notify' | 'reminder'; text: string };

/** `5:00 PM`, spelled out because `toLocaleTimeString` inserts a narrow no-break space on newer ICU. */
function clockTime(time: TimeOfDay): string {
	const [h, m] = time.split(':').map(Number) as [number, number];
	return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `Sat Oct 17`, with the year only when it is not this year. */
function calendarDay(date: DateKey, today: DateKey): string {
	const d = fromDateKey(date);
	const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
	const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	return date.slice(0, 4) === today.slice(0, 4) ? `${weekday} ${day}` : `${weekday} ${day}, ${date.slice(0, 4)}`;
}

function relativeDay(date: DateKey, today: DateKey): string | null {
	if (date === today) return 'Today';
	if (date === addDays(today, 1)) return 'Tomorrow';
	return date === addDays(today, -1) ? 'Yesterday' : null;
}

/** `Tomorrow, Thu Oct 15 at 5:00 PM`. */
function longDue({ date, time }: Due, today: DateKey): string {
	const relative = relativeDay(date, today);
	const day = relative ? `${relative}, ${calendarDay(date, today)}` : calendarDay(date, today);
	return time ? `${day} at ${clockTime(time)}` : day;
}

function duration(minutes: number): string {
	if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
	if (minutes % 60 === 0) return `${minutes / 60} hr`;
	return `${minutes} min`;
}

function describeReminder(reminder: Reminder, due: Due | null, today: DateKey): string {
	switch (reminder.kind) {
		case 'before': {
			const offset = reminder.minutes === 0 ? 'at due time' : `${duration(reminder.minutes)} before`;
			const fires = reminderFiresAt(reminder, due);
			if (!fires) return `Remind ${offset} (needs a due time)`;
			const firesDate = toDateKey(fires);
			const at = clockTime(toTimeOfDay(fires.getHours(), fires.getMinutes()));
			return `Remind ${offset} (${firesDate === due?.date ? at : `${calendarDay(firesDate, today)}, ${at}`})`;
		}
		case 'at': {
			const at = clockTime(reminder.time);
			if (reminder.date === due?.date) return `Remind at ${at}`;
			return `Remind ${relativeDay(reminder.date, today) ?? calendarDay(reminder.date, today)} at ${at}`;
		}
		default: {
			const never: never = reminder;
			return never;
		}
	}
}

/** The full resolved timing, shown above the title input while the text carries a date, repeat, or reminder. A reminder at the due time folds into `Notifies at`, since it notifies once. */
export function describeTiming(
	timing: { due: Due | null; recurrence: Recurrence | null; reminders: readonly Reminder[] },
	today: DateKey,
): TimingSegment[] {
	const segments: TimingSegment[] = [];
	if (timing.due) segments.push({ kind: 'due', text: longDue(timing.due, today) });
	if (timing.recurrence) segments.push({ kind: 'recurrence', text: repeatLabel(timing.recurrence, timing.due) });
	const dueAt = timing.due?.time ? fromDateKey(timing.due.date, timing.due.time).getTime() : null;
	if (timing.due?.time) segments.push({ kind: 'notify', text: `Notifies at ${clockTime(timing.due.time)}` });
	for (const reminder of timing.reminders) {
		if (dueAt !== null && reminderFiresAt(reminder, timing.due)?.getTime() === dueAt) continue;
		segments.push({ kind: 'reminder', text: describeReminder(reminder, timing.due, today) });
	}
	return segments;
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
