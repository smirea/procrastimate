import { expect, test } from 'bun:test';
import { formatRecurrence } from 'shared/format.ts';
import type { DateKey, Due } from 'shared/task.ts';
import { customRepeat, repeatPresets } from './repeat-options.ts';

const due = (date: string): Due => ({ date: date as DateKey, time: null });

test.each([
	['2026-10-19', 'Every Mon', 'Every month on the 3rd Mon'],
	['2026-10-01', 'Every Thu', 'Every month on the 1st Thu'],
	['2026-10-30', 'Every Fri', 'Every month on the last Fri'],
])('the repeat menu for a task due %s offers %p and %p', (date, weekly, monthly) => {
	expect(repeatPresets(date as DateKey).map(preset => formatRecurrence(preset, due(date)))).toEqual([
		'Every day',
		'Every weekday',
		weekly,
		'Every month',
		monthly,
		'Every year',
	]);
});

test('a custom interval keeps the weekday of the month, the day of the month, or the weekdays it repeats on', () => {
	const [, , , , nth] = repeatPresets('2026-10-19' as DateKey);
	expect(formatRecurrence(customRepeat(nth!, 2, 'month'), due('2026-10-19'))).toBe('Every 2 months on the 3rd Mon');
	expect(customRepeat({ interval: 1, unit: 'month', day: 22 }, 3, 'month')).toEqual({
		interval: 3,
		unit: 'month',
		day: 22,
	});
	expect(customRepeat({ interval: 1, unit: 'week', days: [1, 3] }, 2, 'week')).toEqual({
		interval: 2,
		unit: 'week',
		days: [1, 3],
	});
	expect(customRepeat(nth!, 2, 'week')).toEqual({ interval: 2, unit: 'week' });
});
