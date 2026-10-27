import { describe, expect, test } from 'bun:test';
import { upcomingNotifications } from './notifications.ts';
import { toDateKey, type Task } from './task.ts';
import { zonedDateKey, zonedTime } from './zoned-time.ts';

describe('zonedTime', () => {
	test.each([
		['UTC', '2026-10-14', '10:30', '2026-10-14T10:30:00Z'],
		['America/New_York', '2026-10-14', '10:30', '2026-10-14T14:30:00Z'],
		['America/New_York', '2026-12-14', '10:30', '2026-12-14T15:30:00Z'],
		['Asia/Kolkata', '2026-10-14', '00:15', '2026-10-13T18:45:00Z'],
		['Pacific/Kiritimati', '2026-01-01', '00:00', '2025-12-31T10:00:00Z'],
		// Skipped by the spring jump, so it lands an hour later, like `Date` in a local zone.
		['America/New_York', '2026-03-08', '02:30', '2026-03-08T07:30:00Z'],
		// Happens twice in the autumn, so it takes the first.
		['America/New_York', '2026-11-01', '01:30', '2026-11-01T05:30:00Z'],
		['Europe/Berlin', '2026-10-25', '02:30', '2026-10-25T00:30:00Z'],
		['Europe/Berlin', '2026-03-29', '02:30', '2026-03-29T01:30:00Z'],
	] as const)('%s %s %s is %s', (zone, date, time, iso) => {
		expect(zonedTime(date, time, zone)).toBe(Date.parse(iso));
	});

	test('without a zone it is the process zone', () => {
		expect(zonedTime('2026-10-14', '10:30')).toBe(new Date(2026, 9, 14, 10, 30).getTime());
	});
});

describe('zonedDateKey', () => {
	test('names the calendar day in the zone', () => {
		const at = Date.parse('2026-10-14T02:00:00Z');
		expect(zonedDateKey(at, 'UTC')).toBe('2026-10-14');
		expect(zonedDateKey(at, 'America/Los_Angeles')).toBe('2026-10-13');
		expect(zonedDateKey(at, 'Asia/Tokyo')).toBe('2026-10-14');
		expect(zonedDateKey(at)).toBe(toDateKey(new Date(at)));
	});
});

test('notifications resolve and word their times in the given zone', () => {
	const task: Task = {
		id: 'gym',
		title: 'Gym',
		notes: '',
		projectId: null,
		sectionId: null,
		parentId: null,
		order: 0,
		labelIds: [],
		due: { date: '2026-10-15', time: '18:00' },
		recurrence: null,
		priority: 4,
		reminders: [{ kind: 'before', minutes: 1440 }],
		location: null,
		event: null,
		images: [],
		createdAt: 0,
		completedAt: null,
		createdBy: null,
		completedBy: null,
		lastCompletedAt: null,
	};
	const now = Date.parse('2026-10-14T00:00:00Z');
	expect(upcomingNotifications([task], now, 10, 'America/New_York')).toEqual([
		{
			at: Date.parse('2026-10-14T22:00:00Z'),
			title: 'Gym',
			body: 'Tomorrow 6:00 PM',
			opens: { kind: 'task', id: 'gym' },
		},
		{ at: Date.parse('2026-10-15T22:00:00Z'), title: 'Gym', body: 'Today 6:00 PM', opens: { kind: 'task', id: 'gym' } },
	]);
	expect(upcomingNotifications([task], now, 10, 'Asia/Tokyo').map(n => n.at)).toEqual([
		Date.parse('2026-10-14T09:00:00Z'),
		Date.parse('2026-10-15T09:00:00Z'),
	]);
});
