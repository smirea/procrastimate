import { describe, expect, test } from 'bun:test';
import { addInterval, nextOccurrence, notificationTimes, type Due, type Recurrence, type Reminder } from './task.ts';

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
