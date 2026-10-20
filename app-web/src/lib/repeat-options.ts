import { monthlyWeekdayOf, type DateKey, type Recurrence, type RecurrenceUnit } from 'shared/task.ts';

/** The repeat menu's presets for a due date: after `Every month`, its weekday of the month, as in `Every month on the 3rd Mon`. */
export function repeatPresets(date: DateKey): Recurrence[] {
	return [
		{ interval: 1, unit: 'day' },
		{ interval: 1, unit: 'weekday' },
		{ interval: 1, unit: 'week' },
		{ interval: 1, unit: 'month' },
		{ interval: 1, unit: 'month', nth: monthlyWeekdayOf(date) },
		{ interval: 1, unit: 'year' },
	];
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
