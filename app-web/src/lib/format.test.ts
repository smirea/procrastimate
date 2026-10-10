import { describe, expect, test } from 'bun:test';
import type { Due, Recurrence, Reminder } from 'shared/task.ts';
import { describeTiming } from './format.ts';

const today = '2026-10-14';
const texts = (due: Due | null, recurrence: Recurrence | null, reminders: Reminder[] = []) =>
	describeTiming({ due, recurrence, reminders }, today).map(s => s.text);

describe('describeTiming', () => {
	test('a due date with a time, a relative reminder, and a weekly repeat', () => {
		expect(
			texts({ date: '2026-10-19', time: '17:00' }, { interval: 1, unit: 'week' }, [{ kind: 'before', minutes: 30 }]),
		).toEqual(['Mon Oct 19 at 5:00 PM', 'Repeats every Mon', 'Notifies at 5:00 PM', 'Remind 30 min before (4:30 PM)']);
	});

	test.each([
		[{ date: '2026-10-15', time: '09:05' }, 'Tomorrow, Thu Oct 15 at 9:05 AM', '9:05 AM'],
		[{ date: '2026-10-13', time: '00:00' }, 'Yesterday, Tue Oct 13 at 12:00 AM', '12:00 AM'],
		[{ date: '2027-01-08', time: '12:30' }, 'Fri Jan 8, 2027 at 12:30 PM', '12:30 PM'],
	] as const)('due %p reads %p and notifies at %p', (due, expected, at) => {
		expect(texts(due, null)).toEqual([expected, `Notifies at ${at}`]);
	});

	test('a date with no time does not notify', () => {
		expect(texts({ date: '2026-10-14', time: null }, null)).toEqual(['Today, Wed Oct 14']);
	});

	test.each([[{ kind: 'before', minutes: 0 }], [{ kind: 'at', date: '2026-10-15', time: '17:00' }]] as const)(
		'a reminder %p at the due time folds into the due-time notification',
		reminder => {
			expect(texts({ date: '2026-10-15', time: '17:00' }, null, [reminder])).toEqual([
				'Tomorrow, Thu Oct 15 at 5:00 PM',
				'Notifies at 5:00 PM',
			]);
		},
	);

	test.each([
		[{ kind: 'before', minutes: 60 }, 'Remind 1 hr before (4:00 PM)'],
		[{ kind: 'before', minutes: 1440 }, 'Remind 1 day before (Wed Oct 14, 5:00 PM)'],
		[{ kind: 'before', minutes: 2880 }, 'Remind 2 days before (Tue Oct 13, 5:00 PM)'],
		[{ kind: 'at', date: '2026-10-15', time: '09:00' }, 'Remind at 9:00 AM'],
		[{ kind: 'at', date: '2026-10-14', time: '20:00' }, 'Remind Today at 8:00 PM'],
		[{ kind: 'at', date: '2026-10-20', time: '08:15' }, 'Remind Tue Oct 20 at 8:15 AM'],
	] as const)('reminder %p reads %p', (reminder, expected) => {
		expect(texts({ date: '2026-10-15', time: '17:00' }, null, [reminder])).toEqual([
			'Tomorrow, Thu Oct 15 at 5:00 PM',
			'Notifies at 5:00 PM',
			expected,
		]);
	});

	test('a relative reminder without a due time says it needs one', () => {
		expect(texts({ date: '2026-10-15', time: null }, null, [{ kind: 'before', minutes: 10 }])).toEqual([
			'Tomorrow, Thu Oct 15',
			'Remind 10 min before (needs a due time)',
		]);
	});

	test('repeats without a weekday read as an interval', () => {
		expect(texts(null, { interval: 1, unit: 'day' })).toEqual(['Repeats every day']);
		expect(texts(null, { interval: 2, unit: 'month' })).toEqual(['Repeats every 2 months']);
	});
});
