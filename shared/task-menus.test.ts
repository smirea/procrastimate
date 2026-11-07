import { expect } from 'bun:test';
import { formatRecurrence } from './format.ts';
import * as menus from './task-menus.ts';
import type { DateKey, Due, Recurrence } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const repeatPresets = recorded('task-menus', menus.repeatPresets);
const repeatAnchor = recorded('task-menus', menus.repeatAnchor);
const setRepeat = recorded('task-menus', menus.setRepeat);
const repeatWeekdays = recorded('task-menus', menus.repeatWeekdays);
const canToggleWeekday = recorded('task-menus', menus.canToggleWeekday);
const toggleWeekday = recorded('task-menus', menus.toggleWeekday);
const customRepeat = recorded('task-menus', menus.customRepeat);
const isRepeatPreset = recorded('task-menus', menus.isRepeatPreset);
const addReminder = recorded('task-menus', menus.addReminder);
const reminderAt = recorded('task-menus', menus.reminderAt);
const reminderChipLabel = recorded('task-menus', menus.reminderChipLabel);
const reminderSectionTitle = recorded('task-menus', menus.reminderSectionTitle);

const today = '2026-10-14' as DateKey;
const due = (date: string, time: string | null = null) => ({ date, time }) as Due;
const wednesday = due('2026-10-14', '09:00');
const weekly: Recurrence = { interval: 1, unit: 'week' };

describe('repeat menu', () => {
	test.each([
		['2026-10-19', 'Every Mon', 'Every month on the 3rd Mon'],
		['2026-10-01', 'Every Thu', 'Every month on the 1st Thu'],
		['2026-10-30', 'Every Fri', 'Every month on the last Fri'],
	])('the presets for a task due %s offer %p and %p', (date, inWeek, inMonth) => {
		expect(repeatPresets(date as DateKey).map(preset => formatRecurrence(preset, due(date)))).toEqual([
			'Every day',
			'Every weekday',
			inWeek,
			'Every month',
			inMonth,
			'Every year',
		]);
	});

	test('a repeat on an undated task dates it today, and no repeat keeps the date', () => {
		const opened = repeatAnchor(null, today);
		expect(setRepeat({ interval: 1, unit: 'day' }, opened, null)).toEqual({
			recurrence: { interval: 1, unit: 'day' },
			due: due(today),
		});
		expect(setRepeat(null, opened, wednesday)).toEqual({ recurrence: null, due: wednesday });
	});

	test('weekday toggles build a set from the plain weekly repeat', () => {
		expect(repeatWeekdays(weekly, wednesday)).toEqual([3]);
		expect(repeatWeekdays({ interval: 1, unit: 'day' }, wednesday)).toEqual([]);
		const friday = toggleWeekday(5, weekly, wednesday);
		expect(friday).toEqual({ interval: 1, unit: 'week', days: [3, 5] });
		const monday = toggleWeekday(1, friday, wednesday);
		expect(monday.days).toEqual([1, 3, 5]);
		expect(setRepeat(monday, wednesday, wednesday).due).toEqual(wednesday);
		expect(canToggleWeekday(3, [3])).toBe(false);
		expect(canToggleWeekday(3, [3, 5])).toBe(true);
	});

	test('a first toggle makes a weekly repeat on that day and moves the date', () => {
		const next = toggleWeekday(5, null, wednesday);
		expect(next).toEqual({ interval: 1, unit: 'week', days: [5] });
		const set = setRepeat(next, wednesday, wednesday);
		expect(set).toEqual({ recurrence: weekly, due: due('2026-10-16', '09:00') });
		expect(isRepeatPreset(weekly, set.recurrence)).toBe(true);
	});

	test('toggle order never changes the result', () => {
		const a = toggleWeekday(1, toggleWeekday(5, null, wednesday), wednesday);
		const b = toggleWeekday(5, toggleWeekday(1, null, wednesday), wednesday);
		expect(setRepeat(a, wednesday, wednesday)).toEqual(setRepeat(b, wednesday, wednesday));
		expect(setRepeat(a, wednesday, wednesday).due?.date).toBe('2026-10-16');
	});

	test('a custom weekly interval keeps the set, and a weekday set matches no preset', () => {
		const set: Recurrence = { interval: 1, unit: 'week', days: [2, 4] };
		expect(customRepeat(set, 2, 'week')).toEqual({ interval: 2, unit: 'week', days: [2, 4] });
		expect(customRepeat(set, 3, 'day')).toEqual({ interval: 3, unit: 'day' });
		expect(toggleWeekday(1, { interval: 2, unit: 'week', days: [2, 4] }, wednesday).interval).toBe(2);
		expect(repeatPresets(wednesday.date).some(preset => isRepeatPreset(preset, set))).toBe(false);
	});

	test('a custom monthly interval keeps the day, and a day of the month matches no preset', () => {
		const onThe31st: Recurrence = { interval: 1, unit: 'month', day: 31 };
		expect(customRepeat(onThe31st, 2, 'month')).toEqual({ interval: 2, unit: 'month', day: 31 });
		expect(customRepeat(onThe31st, 2, 'week')).toEqual({ interval: 2, unit: 'week' });
		expect(repeatPresets(wednesday.date).some(preset => isRepeatPreset(preset, onThe31st))).toBe(false);
	});

	test('the weekday-of-the-month preset moves the date, and a custom interval keeps it', () => {
		const lastFriday: Recurrence = { interval: 1, unit: 'month', nth: { week: -1, weekday: 5 } };
		expect(setRepeat(lastFriday, wednesday, wednesday).due).toEqual(due('2026-10-30', '09:00'));
		expect(customRepeat(lastFriday, 2, 'month')).toEqual({ interval: 2, unit: 'month', nth: lastFriday.nth });
		const secondWednesday = repeatPresets(wednesday.date)[4]!;
		expect(isRepeatPreset(secondWednesday, { interval: 1, unit: 'month', nth: { week: 2, weekday: 3 } })).toBe(true);
		expect(isRepeatPreset({ interval: 1, unit: 'month' }, lastFriday)).toBe(false);
	});

	test('a repeat past the year 9999 keeps the opened date', () => {
		const late = due('9999-12-20');
		expect(setRepeat({ interval: 1, unit: 'month', day: 15 }, late, late).due).toEqual(late);
	});
});

describe('reminder menu', () => {
	test('a reminder adds once, and a custom one defaults to the due date, else today', () => {
		expect(addReminder({ kind: 'before', minutes: 10 }, [{ kind: 'before', minutes: 10 }])).toBeNull();
		expect(addReminder({ kind: 'before', minutes: 30 }, [{ kind: 'before', minutes: 10 }])).toEqual([
			{ kind: 'before', minutes: 10 },
			{ kind: 'before', minutes: 30 },
		]);
		expect(reminderAt(null, '08:00', due('2026-10-16'), today)).toEqual({
			kind: 'at',
			date: '2026-10-16',
			time: '08:00',
		});
		expect(reminderAt(null, '08:00', null, today)).toEqual({ kind: 'at', date: today, time: '08:00' });
		expect(reminderAt('2026-10-20' as DateKey, '08:00', due('2026-10-16'), today)).toEqual({
			kind: 'at',
			date: '2026-10-20',
			time: '08:00',
		});
	});

	test('the chip and section name what the menu holds', () => {
		expect([0, 1, 2].map(reminderChipLabel)).toEqual(['Add reminder', '1 reminder', '2 reminders']);
		expect(reminderSectionTitle(due('2026-10-16'))).toBe('Before due time · needs a time');
		expect(reminderSectionTitle(wednesday)).toBe('Before due time');
	});
});
