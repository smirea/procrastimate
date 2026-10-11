import { expect } from 'bun:test';
import * as dates from './task.ts';
import type { Due, Recurrence, Reminder } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const addDays = recorded('task', dates.addDays);
const addInterval = recorded('task', dates.addInterval);
const addMonths = recorded('task', dates.addMonths);
const alignToRecurrence = recorded('task', dates.alignToRecurrence);
const fromDateKey = recorded('task', dates.fromDateKey);
const isWeekday = recorded('task', dates.isWeekday);
const nextOccurrence = recorded('task', dates.nextOccurrence);
const notificationTimes = recorded('task', dates.notificationTimes);
const reminderFiresAt = recorded('task', dates.reminderFiresAt);
const sortWeekdays = recorded('task', dates.sortWeekdays);
const stepRecurrence = recorded('task', dates.stepRecurrence);
const toDateKey = recorded('task', dates.toDateKey);
const weekdayOf = recorded('task', dates.weekdayOf);
const weeklyOn = recorded('task', dates.weeklyOn);

const at = (date: Date) => date.toISOString();
const times = (due: Due | null, reminders: Reminder[] = []) => notificationTimes(due, reminders).map(at);
const local = (date: string, time: string) => at(new Date(`${date}T${time}:00`));

describe('notificationTimes', () => {
	test('a due time notifies at that time with no reminder', () => {
		expect(times({ date: '2026-10-15', time: '17:00' })).toEqual([local('2026-10-15', '17:00')]);
	});

	test('a date with no time does not notify', () => {
		expect(times({ date: '2026-10-15', time: null })).toEqual([]);
		expect(times(null)).toEqual([]);
	});

	test('reminders add to the due time, in order', () => {
		expect(
			times({ date: '2026-10-15', time: '17:00' }, [
				{ kind: 'at', date: '2026-10-15', time: '18:00' },
				{ kind: 'before', minutes: 30 },
			]),
		).toEqual([local('2026-10-15', '16:30'), local('2026-10-15', '17:00'), local('2026-10-15', '18:00')]);
	});

	test('a reminder at the due time notifies once', () => {
		expect(
			times({ date: '2026-10-15', time: '17:00' }, [
				{ kind: 'before', minutes: 0 },
				{ kind: 'at', date: '2026-10-15', time: '17:00' },
			]),
		).toEqual([local('2026-10-15', '17:00')]);
	});

	test('a date-only task still notifies at an absolute reminder', () => {
		expect(
			times({ date: '2026-10-15', time: null }, [
				{ kind: 'before', minutes: 10 },
				{ kind: 'at', date: '2026-10-15', time: '09:00' },
			]),
		).toEqual([local('2026-10-15', '09:00')]);
	});
});

// Wednesday, October 14 2026.
const today = '2026-10-14';

const next = (due: Due | null, recurrence: Recurrence | null, reminders: Reminder[] = []) =>
	nextOccurrence({ due, recurrence, reminders }, today);

describe('addInterval', () => {
	test.each([
		['2026-10-14', 1, 'weekday', '2026-10-15'],
		['2026-10-16', 1, 'weekday', '2026-10-19'],
		['2026-10-17', 1, 'weekday', '2026-10-19'],
		['2026-10-15', 3, 'weekday', '2026-10-20'],
		['2026-01-31', 1, 'month', '2026-02-28'],
		['2028-02-29', 1, 'year', '2029-02-28'],
	] as const)('%s plus %d %s is %s', (from, interval, unit, expected) => {
		expect(addInterval(from, interval, unit)).toBe(expected);
	});
});

describe('nextOccurrence', () => {
	test.each([
		['daily from today', { date: '2026-10-14', time: '09:00' }, { interval: 1, unit: 'day' }, '2026-10-15'],
		[
			'daily, overdue, skips to tomorrow',
			{ date: '2026-10-10', time: null },
			{ interval: 1, unit: 'day' },
			'2026-10-15',
		],
		[
			'every 3 days, overdue, stays on its cadence',
			{ date: '2026-10-10', time: null },
			{ interval: 3, unit: 'day' },
			'2026-10-16',
		],
		['weekly from Monday', { date: '2026-10-12', time: null }, { interval: 1, unit: 'week' }, '2026-10-19'],
		['every 2 weeks', { date: '2026-10-14', time: null }, { interval: 2, unit: 'week' }, '2026-10-28'],
		[
			'weekdays, completed early on Friday',
			{ date: '2026-10-16', time: null },
			{ interval: 1, unit: 'weekday' },
			'2026-10-19',
		],
		[
			'monthly on the 31st, overdue, carries the clamped 28th',
			{ date: '2026-01-31', time: null },
			{ interval: 1, unit: 'month' },
			'2026-10-28',
		],
		['yearly', { date: '2026-03-01', time: null }, { interval: 1, unit: 'year' }, '2027-03-01'],
	] as const)('%s', (_, due, recurrence, expected) => {
		expect(next(due, recurrence)).toEqual({ due: { date: expected, time: due.time }, reminders: [] });
	});

	test.each([
		['2026-01-31', 'month', '2026-01-31', '2026-02-28'],
		['2026-02-28', 'month', '2026-02-28', '2026-03-28'],
		['2026-01-31', 'month', '2026-03-01', '2026-03-28'],
		['2028-02-29', 'year', '2028-02-29', '2029-02-28'],
		['2028-02-29', 'year', '2029-03-01', '2030-02-28'],
	] as const)(
		'due %s every %s, completed %s, lands on %s from the clamped date',
		(date, unit, completedOn, expected) => {
			const task = { due: { date, time: null }, recurrence: { interval: 1, unit }, reminders: [] };
			expect(nextOccurrence(task, completedOn)?.due.date).toBe(expected);
		},
	);

	test('a recurring task with no due date counts from today', () => {
		expect(next(null, { interval: 1, unit: 'week' })).toEqual({
			due: { date: '2026-10-21', time: null },
			reminders: [],
		});
	});

	test('absolute reminders shift with the due date and relative ones stay', () => {
		const reminders: Reminder[] = [
			{ kind: 'before', minutes: 30 },
			{ kind: 'at', date: '2026-10-13', time: '20:00' },
		];
		expect(next({ date: '2026-10-14', time: '09:00' }, { interval: 1, unit: 'week' }, reminders)).toEqual({
			due: { date: '2026-10-21', time: '09:00' },
			reminders: [
				{ kind: 'before', minutes: 30 },
				{ kind: 'at', date: '2026-10-20', time: '20:00' },
			],
		});
	});

	test('a task without a repeat has no next occurrence', () => {
		expect(next({ date: '2026-10-14', time: null }, null)).toBe(null);
		expect(next(null, { interval: 1, unit: 'day' })?.due).toEqual({ date: '2026-10-15', time: null });
	});
});

const MWF: Recurrence = { interval: 1, unit: 'week', days: [1, 3, 5] };

describe('stepRecurrence on a weekday set', () => {
	test.each([
		['Mon to Wed', '2026-10-12', MWF, '2026-10-14'],
		['Wed to Fri', '2026-10-14', MWF, '2026-10-16'],
		['Fri wraps to next Mon', '2026-10-16', MWF, '2026-10-19'],
		['an unlisted Tue goes to Wed', '2026-10-13', MWF, '2026-10-14'],
		['an unlisted Sat wraps to Mon', '2026-10-17', MWF, '2026-10-19'],
		['Sat to Sun stays in the week', '2026-10-17', { interval: 1, unit: 'week', days: [6, 0] }, '2026-10-18'],
		['Sun wraps to Sat', '2026-10-18', { interval: 1, unit: 'week', days: [6, 0] }, '2026-10-24'],
		['every 2 weeks, Thu wraps two weeks', '2026-10-15', { interval: 2, unit: 'week', days: [2, 4] }, '2026-10-27'],
		['every 2 weeks, Tue to Thu', '2026-10-13', { interval: 2, unit: 'week', days: [2, 4] }, '2026-10-15'],
		['a single listed day steps a week', '2026-10-14', { interval: 1, unit: 'week', days: [3] }, '2026-10-21'],
		['no set keeps the interval', '2026-10-14', { interval: 3, unit: 'day' }, '2026-10-17'],
	] as const)('%s', (_, from, recurrence, expected) => {
		expect(stepRecurrence(from, recurrence)).toBe(expected);
	});

	test.each([
		['a listed day stays', '2026-10-14', MWF, '2026-10-14'],
		['an unlisted day moves to the next listed one', '2026-10-15', MWF, '2026-10-16'],
		['every 2 weeks still starts this week', '2026-10-13', { interval: 2, unit: 'week', days: [5] }, '2026-10-16'],
		[
			'every 2 weeks past the last day starts next week',
			'2026-10-17',
			{ interval: 2, unit: 'week', days: [1] },
			'2026-10-19',
		],
		['no set leaves the date alone', '2026-10-15', { interval: 1, unit: 'week' }, '2026-10-15'],
	] as const)('alignToRecurrence: %s', (_, from, recurrence, expected) => {
		expect(alignToRecurrence(from, recurrence)).toBe(expected);
	});
});

test.each([
	[[5, 1, 3, 1], { interval: 1, unit: 'week', days: [1, 3, 5] }],
	[[0, 6], { interval: 1, unit: 'week', days: [6, 0] }],
	[[5], { interval: 1, unit: 'week' }],
	[[5, 5], { interval: 1, unit: 'week' }],
	[[], { interval: 1, unit: 'week' }],
] as const)('weeklyOn %p is %p', (days, expected) => {
	expect<unknown>(weeklyOn(1, days)).toEqual(expected);
});

describe('nextOccurrence on a weekday set', () => {
	test.each([
		['completed on time Wed moves to Fri', '2026-10-14', '2026-10-16'],
		['overdue from Mon skips today, a listed Wed, to Fri', '2026-10-12', '2026-10-16'],
		['overdue from last Fri skips to Fri', '2026-10-09', '2026-10-16'],
		['a future Fri moves to next Mon', '2026-10-16', '2026-10-19'],
	] as const)('%s', (_, date, expected) => {
		expect(next({ date, time: '07:00' }, MWF)?.due).toEqual({ date: expected, time: '07:00' });
	});

	test('the due time and a relative reminder notify at the next listed day', () => {
		const rolled = next({ date: '2026-10-14', time: '07:00' }, MWF, [{ kind: 'before', minutes: 10 }])!;
		expect(times(rolled.due, rolled.reminders)).toEqual([local('2026-10-16', '06:50'), local('2026-10-16', '07:00')]);
	});

	test('an absolute reminder shifts by the days between occurrences', () => {
		const rolled = next({ date: '2026-10-16', time: '07:00' }, MWF, [
			{ kind: 'at', date: '2026-10-15', time: '20:00' },
		])!;
		expect(rolled.reminders).toEqual([{ kind: 'at', date: '2026-10-18', time: '20:00' }]);
	});
});

describe('a repeating task notifies at its next occurrence', () => {
	test('the next due time notifies with no reminder set', () => {
		const rolled = next({ date: '2026-10-14', time: '10:30' }, { interval: 1, unit: 'day' })!;
		expect(times(rolled.due, rolled.reminders)).toEqual([local('2026-10-15', '10:30')]);
	});

	test('reminders roll with it and still notify once at the due time', () => {
		const rolled = next({ date: '2026-10-14', time: '17:00' }, { interval: 1, unit: 'week' }, [
			{ kind: 'before', minutes: 30 },
			{ kind: 'at', date: '2026-10-14', time: '17:00' },
		])!;
		expect(times(rolled.due, rolled.reminders)).toEqual([local('2026-10-21', '16:30'), local('2026-10-21', '17:00')]);
	});
});

describe('calendar dates', () => {
	test.each([
		['2026-10-14', 1, '2026-10-15'],
		['2026-10-31', 2, '2026-11-02'],
		['2026-12-31', 1, '2027-01-01'],
		['2026-03-01', -1, '2026-02-28'],
		['2028-02-28', 1, '2028-02-29'],
	] as const)('addDays %s %d is %s', (from, days, expected) => {
		expect(addDays(from, days)).toBe(expected);
	});

	test.each([
		['2026-01-31', 1, '2026-02-28'],
		['2026-03-31', -1, '2026-02-28'],
		['2026-12-15', 2, '2027-02-15'],
		['2028-01-30', 1, '2028-02-29'],
		['2026-10-14', -12, '2025-10-14'],
	] as const)('addMonths %s %d is %s', (from, months, expected) => {
		expect(addMonths(from, months)).toBe(expected);
	});

	test.each([
		['2026-10-14', 3, true],
		['2026-10-17', 6, false],
		['2026-10-18', 0, false],
		['2026-11-01', 0, false],
		['2026-11-02', 1, true],
	] as const)('%s is weekday %d, a working day: %p', (date, weekday, working) => {
		expect(weekdayOf(date)).toBe(weekday);
		expect(isWeekday(date)).toBe(working);
	});

	test('weekdays sort Monday first without repeats', () => {
		expect(sortWeekdays([0, 3, 1, 3])).toEqual([1, 3, 0]);
	});

	test('a moment reads as the local day it falls on', () => {
		expect(toDateKey(new Date(2026, 10, 1, 23, 30))).toBe('2026-11-01');
		expect(toDateKey(new Date(2026, 10, 2, 0, 15))).toBe('2026-11-02');
	});
});

describe('times across the DST change', () => {
	test('a local time keeps its wall clock on either side of the change', () => {
		expect(fromDateKey('2026-10-31', '09:00')).toEqual(new Date(2026, 9, 31, 9, 0));
		expect(fromDateKey('2026-11-01', '09:00')).toEqual(new Date(2026, 10, 1, 9, 0));
		expect(fromDateKey('2026-11-01')).toEqual(new Date(2026, 10, 1));
	});

	test('a repeated hour resolves to its first occurrence and a skipped hour moves forward', () => {
		expect(fromDateKey('2026-11-01', '01:30')).toEqual(new Date(2026, 10, 1, 1, 30));
		expect(fromDateKey('2027-03-14', '02:30')).toEqual(new Date(2027, 2, 14, 2, 30));
	});

	test('a relative reminder counts elapsed minutes across the change', () => {
		const due: Due = { date: '2026-11-02', time: '09:00' };
		const dueAt = dates.fromDateKey(due.date, due.time);
		expect(reminderFiresAt({ kind: 'before', minutes: 1440 }, due)?.getTime()).toBe(dueAt.getTime() - 86_400_000);
		expect(reminderFiresAt({ kind: 'before', minutes: 30 }, { date: '2026-11-02', time: null })).toBeNull();
		expect(reminderFiresAt({ kind: 'at', date: '2026-11-01', time: '08:00' }, null)).toEqual(new Date(2026, 10, 1, 8));
	});

	test('a daily repeat keeps its wall-clock time across the change', () => {
		const rolled = nextOccurrence(
			{ due: { date: '2026-10-31', time: '09:00' }, recurrence: { interval: 1, unit: 'day' }, reminders: [] },
			'2026-10-31',
		)!;
		expect(times(rolled.due, rolled.reminders)).toEqual([local('2026-11-01', '09:00')]);
	});
});
