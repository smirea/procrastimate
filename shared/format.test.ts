import { expect } from 'bun:test';
import * as format from './format.ts';
import { describe, recorded, test } from './vectors/record.ts';

const calendarDay = recorded('format', format.calendarDay);
const clockTime = recorded('format', format.clockTime);
const completedToast = recorded('format', format.completedToast);
const dayHeading = recorded('format', format.dayHeading);
const dueTone = recorded('format', format.dueTone);
const formatDate = recorded('format', format.formatDate);
const formatDue = recorded('format', format.formatDue);
const formatMinutes = recorded('format', format.formatMinutes);
const formatRecurrence = recorded('format', format.formatRecurrence);
const formatReminder = recorded('format', format.formatReminder);
const formatTime = recorded('format', format.formatTime);
const postponeOptions = recorded('format', format.postponeOptions);
const priorityLabel = recorded('format', format.priorityLabel);
const relativeDay = recorded('format', format.relativeDay);
const addedAgo = recorded('format', format.addedAgo);
const reminderToast = recorded('format', format.reminderToast);
const repeatLabel = recorded('format', format.repeatLabel);
const completedWhen = recorded('format', format.completedWhen);
const completedHeading = recorded('format', format.completedHeading);
const reopenedToast = recorded('format', format.reopenedToast);
const completedRangeLabel = recorded('format', format.completedRangeLabel);

// Wednesday, October 14 2026.
const today = '2026-10-14';

describe('formatRecurrence', () => {
	test.each([
		[{ interval: 1, unit: 'week', days: [1, 3, 5] }, 'Every Mon, Wed, Fri'],
		[{ interval: 1, unit: 'week', days: [6, 0] }, 'Every Sat, Sun'],
		[{ interval: 2, unit: 'week', days: [2, 4] }, 'Every 2 weeks on Tue, Thu'],
		[{ interval: 2, unit: 'week' }, 'Every 2 weeks'],
		[{ interval: 1, unit: 'week' }, 'Every Wed'],
		[{ interval: 1, unit: 'weekday' }, 'Every weekday'],
		[{ interval: 3, unit: 'day' }, 'Every 3 days'],
		[{ interval: 1, unit: 'year' }, 'Every year'],
		[{ interval: 1, unit: 'month', day: 3 }, 'Every month on the 3rd'],
		[{ interval: 1, unit: 'month', day: 1 }, 'Every month on the 1st'],
		[{ interval: 1, unit: 'month', day: 22 }, 'Every month on the 22nd'],
		[{ interval: 1, unit: 'month', day: 11 }, 'Every month on the 11th'],
		[{ interval: 1, unit: 'month', day: 12 }, 'Every month on the 12th'],
		[{ interval: 1, unit: 'month', day: 13 }, 'Every month on the 13th'],
		[{ interval: 2, unit: 'month', day: 31 }, 'Every 2 months on the 31st'],
	] as const)('%p reads %p', (recurrence, expected) => {
		expect(formatRecurrence(recurrence, { date: today, time: null })).toBe(expected);
	});

	test('a weekly repeat without a due date names no day', () => {
		expect(formatRecurrence({ interval: 1, unit: 'week' }, null)).toBe('Every week');
	});

	test('the repeat icon is named after the repeat', () => {
		expect(repeatLabel({ interval: 1, unit: 'week', days: [1, 3, 5] }, null)).toBe('Repeats every Mon, Wed, Fri');
		expect(repeatLabel({ interval: 2, unit: 'month' }, { date: today, time: null })).toBe('Repeats every 2 months');
	});
});

describe('times', () => {
	test.each([
		['00:00', '12am', '12:00 AM'],
		['09:05', '9:05am', '9:05 AM'],
		['12:00', '12pm', '12:00 PM'],
		['17:30', '5:30pm', '5:30 PM'],
		['23:59', '11:59pm', '11:59 PM'],
	] as const)('%s reads %s on chips and %s in notifications', (time, chip, clock) => {
		expect(formatTime(time)).toBe(chip);
		expect(clockTime(time)).toBe(clock);
	});

	test.each([
		[5, '5m'],
		[90, '90m'],
		[120, '2h'],
		[1440, '1d'],
		[2880, '2d'],
	] as const)('%d minutes read %s', (minutes, expected) => {
		expect(formatMinutes(minutes)).toBe(expected);
	});
});

describe('dates', () => {
	test.each([
		['2026-10-14', 'Today'],
		['2026-10-15', 'Tomorrow'],
		['2026-10-13', 'Yesterday'],
		['2026-10-16', 'Friday'],
		['2026-10-20', 'Tuesday'],
		['2026-10-21', 'Oct 21'],
		['2026-10-10', 'Oct 10'],
		['2027-01-03', 'Jan 3, 2027'],
		['2025-12-31', 'Dec 31, 2025'],
	] as const)('%s reads %s', (date, expected) => {
		expect(formatDate(date, today)).toBe(expected);
	});

	test('a due date adds its time', () => {
		expect(formatDue({ date: '2026-10-15', time: '17:00' }, today)).toBe('Tomorrow 5pm');
		expect(formatDue({ date: '2026-11-02', time: null }, today)).toBe('Nov 2');
	});

	test.each([
		['2026-10-10', 'overdue'],
		['2026-10-14', 'today'],
		['2026-10-15', 'soon'],
		['2026-10-17', 'soon'],
		['2026-10-18', 'week'],
		['2026-10-21', 'week'],
		['2026-10-22', 'later'],
	] as const)('%s is tinted %s', (date, tone) => {
		expect(dueTone({ date, time: null }, today)).toBe(tone);
	});

	test.each([
		['2026-10-14', 'Today'],
		['2026-10-15', 'Tomorrow'],
		['2026-10-13', 'Yesterday'],
		['2026-10-16', null],
	] as const)('%s is relatively %p', (date, expected) => {
		expect(relativeDay(date, today)).toBe(expected);
	});

	test.each([
		['2026-10-14', 'Today'],
		['2026-10-13', 'Yesterday'],
		['2026-10-11', '3 days ago'],
		['2026-10-07', '1 week ago'],
		['2026-09-16', '4 weeks ago'],
		['2026-09-14', '1 month ago'],
		['2026-03-01', '7 months ago'],
		['2025-10-14', '1 year ago'],
		['2023-10-01', '3 years ago'],
	] as const)('added on %s reads %p', (date, expected) => {
		expect(addedAgo(date, today)).toBe(expected);
	});

	test.each([
		['2026-10-17', 'Sat Oct 17'],
		['2026-11-01', 'Sun Nov 1'],
		['2027-02-01', 'Mon Feb 1, 2027'],
	] as const)('%s is the calendar day %s', (date, expected) => {
		expect(calendarDay(date, today)).toBe(expected);
	});

	test.each([
		['2026-10-15', 'Tomorrow'],
		['2026-10-16', 'Friday'],
		['2026-10-20', 'Tuesday'],
		['2026-10-31', 'Sat, Oct 31'],
		['2027-02-26', 'Fri, Feb 26, 2027'],
	] as const)('the Inbox heading for %s is %s', (date, expected) => {
		expect(dayHeading(date, today)).toBe(expected);
	});
});

describe('reminders', () => {
	test.each([
		[{ kind: 'before', minutes: 0 }, 'At due time'],
		[{ kind: 'before', minutes: 30 }, '30m before'],
		[{ kind: 'before', minutes: 1440 }, '1d before'],
		[{ kind: 'at', date: '2026-10-15', time: '09:00' }, 'Tomorrow 9am'],
		[{ kind: 'at', date: '2026-10-30', time: '18:30' }, 'Oct 30 6:30pm'],
	] as const)('%p reads %s', (reminder, expected) => {
		expect(formatReminder(reminder, today)).toBe(expected);
	});
});

describe('labels and toasts', () => {
	test('priorities are named by level', () => {
		expect([1, 2, 3, 4].map(p => priorityLabel(p as 1 | 2 | 3 | 4))).toEqual([
			'Priority 1',
			'Priority 2',
			'Priority 3',
			'Priority 4',
		]);
	});

	test('completing names the task, and a repeat names its next due date', () => {
		expect(completedToast('Standup', null, today)).toBe('Completed “Standup”');
		expect(completedToast('Standup', { date: '2026-10-16', time: '09:00' }, today)).toBe(
			'Completed “Standup”, next due Friday 9am',
		);
	});

	test('a reminder toast names the task', () => {
		expect(reminderToast('Call mom')).toBe('Reminder: Call mom');
	});

	test('reopening names the task', () => {
		expect(reopenedToast('Pay rent')).toBe('Reopened “Pay rent”');
	});
});

describe('completed', () => {
	test('a completion reads as its local day and time', () => {
		expect(completedWhen(new Date(2026, 9, 14, 15, 4).getTime(), today)).toBe('Today 3:04pm');
		expect(completedWhen(new Date(2026, 9, 13, 9, 0).getTime(), today)).toBe('Yesterday 9am');
		expect(completedWhen(new Date(2026, 9, 9, 0, 30).getTime(), today)).toBe('Oct 9 12:30am');
		expect(completedWhen(new Date(2025, 11, 31, 23, 59).getTime(), today)).toBe('Dec 31, 2025 11:59pm');
	});

	test('a range reads as its preset, else as its days', () => {
		const ranges = [
			{ from: null, to: null },
			{ from: today, to: today },
			{ from: '2026-10-08', to: today },
			{ from: '2026-09-15', to: today },
			{ from: '2026-10-01', to: '2026-10-12' },
			{ from: '2026-10-09', to: '2026-10-09' },
			{ from: '2025-12-30', to: today },
			{ from: null, to: '2026-10-12' },
			{ from: '2026-10-01', to: null },
		] as const;
		expect(ranges.map(r => completedRangeLabel(r, today))).toEqual([
			'All time',
			'Today',
			'Last 7 days',
			'Last 30 days',
			'Oct 1 – Oct 12',
			'Oct 9',
			'Dec 30, 2025 – Oct 14',
			'Until Oct 12',
			'Since Oct 1',
		]);
	});

	test('day headings name today and yesterday, then the weekday and date', () => {
		expect(
			(['2026-10-14', '2026-10-13', '2026-10-12', '2025-12-31'] as const).map(d => completedHeading(d, today)),
		).toEqual(['Today', 'Yesterday', 'Mon, Oct 12', 'Wed, Dec 31, 2025']);
	});
});

describe('postpone', () => {
	test('offers tomorrow, the coming weekend, and next week, keeping only new days', () => {
		expect(postponeOptions({ date: today, time: '09:00' }, today)).toEqual([
			{ label: 'Tomorrow', date: '2026-10-15' },
			{ label: 'This weekend', date: '2026-10-17' },
			{ label: 'Next week', date: '2026-10-19' },
		]);
		expect(postponeOptions({ date: '2026-10-15', time: null }, today).map(o => o.label)).toEqual([
			'This weekend',
			'Next week',
		]);
	});

	test('an overdue or undated task can move to today', () => {
		expect(postponeOptions(null, today)[0]).toEqual({ label: 'Today', date: today });
		expect(postponeOptions({ date: '2026-10-01', time: null }, today)[0]).toEqual({ label: 'Today', date: today });
	});

	test('on a Friday the weekend is tomorrow, and on a weekend it is the next one', () => {
		expect(postponeOptions(null, '2026-10-16')).toEqual([
			{ label: 'Today', date: '2026-10-16' },
			{ label: 'Tomorrow', date: '2026-10-17' },
			{ label: 'Next week', date: '2026-10-19' },
		]);
		expect(postponeOptions({ date: '2026-10-17', time: null }, '2026-10-17')).toEqual([
			{ label: 'Tomorrow', date: '2026-10-18' },
			{ label: 'Next weekend', date: '2026-10-24' },
			{ label: 'Next week', date: '2026-10-19' },
		]);
	});
});
