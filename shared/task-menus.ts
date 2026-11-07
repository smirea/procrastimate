import {
	alignToRecurrence,
	monthlyWeekdayOf,
	sortWeekdays,
	weekdayOf,
	weeklyOn,
	type DateKey,
	type Due,
	type Recurrence,
	type RecurrenceUnit,
	type Reminder,
	type TimeOfDay,
	type Weekday,
} from './task.ts';

/**
 * The repeat and reminder menus of task details and quick add: presets, a custom interval, and a row of weekday
 * toggles, Monday first, that edits a weekly set while the menu stays open.
 */

export const REPEAT_UNITS: readonly RecurrenceUnit[] = ['day', 'weekday', 'week', 'month', 'year'];
export const REPEAT_WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const MAX_CUSTOM_INTERVAL = 365;

/** One per unit, with the date's weekday of the month after `Every month`, as in `Every month on the 3rd Mon`. */
export function repeatPresets(date: DateKey): Recurrence[] {
	return REPEAT_UNITS.flatMap((unit): Recurrence[] =>
		unit === 'month'
			? [
					{ interval: 1, unit },
					{ interval: 1, unit, nth: monthlyWeekdayOf(date) },
				]
			: [{ interval: 1, unit }],
	);
}

/** Setting a repeat on an undated task dates it today, so presets read as they will apply. */
export const repeatAnchor = (due: Due | null, today: DateKey): Due => due ?? { date: today, time: null };

/**
 * The repeat to store and the due date it starts on: the first occurrence on or after `opened`, the due date the menu
 * opened with, so toggle order never changes the result. A one-day set is stored as a plain weekly repeat.
 */
export function setRepeat(
	next: Recurrence | null,
	opened: Due,
	due: Due | null,
): { recurrence: Recurrence | null; due: Due | null } {
	if (!next) return { recurrence: null, due };
	const stored = next.unit === 'week' && next.days ? weeklyOn(next.interval, next.days) : next;
	return { recurrence: stored, due: { ...opened, date: alignToRecurrence(opened.date, next) ?? opened.date } };
}

/** A plain weekly repeat already repeats on its due weekday. Any other repeat starts with no days. */
export function repeatWeekdays(recurrence: Recurrence | null, anchor: Due): readonly Weekday[] {
	if (recurrence?.unit !== 'week') return [];
	return recurrence.days ?? [weekdayOf(anchor.date)];
}

/** The last selected day cannot be turned off, so clearing goes through `Don't repeat`. */
export const canToggleWeekday = (day: Weekday, weekdays: readonly Weekday[]) =>
	!(weekdays.length === 1 && weekdays[0] === day);

/** The repeat a weekday toggle asks for. A custom weekly interval keeps its interval. */
export function toggleWeekday(
	day: Weekday,
	recurrence: Recurrence | null,
	anchor: Due,
): Extract<Recurrence, { unit: 'week' }> {
	const current = repeatWeekdays(recurrence, anchor);
	const days = sortWeekdays(current.includes(day) ? current.filter(d => d !== day) : [...current, day]);
	return { interval: recurrence?.unit === 'week' ? recurrence.interval : 1, unit: 'week', days };
}

/** A custom weekly interval keeps the weekday set, and a custom monthly one its day or weekday of the month. */
export function customRepeat(current: Recurrence | null, interval: number, unit: RecurrenceUnit): Recurrence {
	if (unit === 'week' && current?.unit === 'week' && current.days) return { interval, unit, days: current.days };
	if (unit === 'month' && current?.unit === 'month') {
		if (current.nth) return { interval, unit, nth: current.nth };
		if (current.day) return { interval, unit, day: current.day };
	}
	return { interval, unit };
}

const nthOf = (r: Recurrence) => (r.unit === 'month' && r.nth ? `${r.nth.week} ${r.nth.weekday}` : null);

/** Whether a preset shows as the current repeat. A weekday set or a day of the month matches none. */
export const isRepeatPreset = (preset: Recurrence, recurrence: Recurrence | null) =>
	recurrence?.interval === preset.interval &&
	recurrence.unit === preset.unit &&
	!(recurrence.unit === 'week' && recurrence.days) &&
	!(recurrence.unit === 'month' && recurrence.day) &&
	nthOf(recurrence) === nthOf(preset);

/** Minutes before the due time: at due time, 10m, 30m, 1h, and 1d. */
export const REMINDER_PRESETS = [0, 10, 30, 60, 1440];

const sameReminder = (a: Reminder, b: Reminder) => JSON.stringify(a) === JSON.stringify(b);

/** `reminders` with `reminder` added, or null when the task already has the same one. */
export const addReminder = (reminder: Reminder, reminders: readonly Reminder[]): Reminder[] | null =>
	reminders.some(r => sameReminder(r, reminder)) ? null : [...reminders, reminder];

/** A reminder at a moment, on the picked date, else the due date, else today. */
export const reminderAt = (date: DateKey | null, time: TimeOfDay, due: Due | null, today: DateKey): Reminder => ({
	kind: 'at',
	date: date ?? due?.date ?? today,
	time,
});

/** `1 reminder`, `2 reminders`, or `Add reminder` for the chip's accessible name. */
export const reminderChipLabel = (count: number) =>
	count === 0 ? 'Add reminder' : `${count} reminder${count > 1 ? 's' : ''}`;

export const reminderSectionTitle = (due: Due | null) =>
	due?.time ? 'Before due time' : 'Before due time · needs a time';
