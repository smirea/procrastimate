import { expect } from 'bun:test';
import * as notifications from './notifications.ts';
import { nextOccurrence, type Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const notificationBody = recorded('notifications', notifications.notificationBody);
const upcomingNotifications = recorded('notifications', notifications.upcomingNotifications);
const pushSchedule = (tasks: readonly Task[], now: number) => upcomingNotifications(tasks, now, 500);

/** Local wall-clock time in epoch milliseconds, matching how tasks resolve their times. */
const local = (y: number, month: number, d: number, h: number, min = 0) => new Date(y, month - 1, d, h, min).getTime();
const NOW = local(2026, 10, 14, 10);

const task = (id: string, patch: Partial<Task>): Task => ({
	id,
	title: id,
	notes: '',
	projectId: null,
	parentId: null,
	order: 0,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	createdAt: 0,
	completedAt: null,
	...patch,
});

describe('upcomingNotifications', () => {
	test('due times and reminders, soonest first, with bodies relative to the moment they show', () => {
		const tasks = [
			task('Gym', {
				due: { date: '2026-10-15', time: '17:00' },
				reminders: [
					{ kind: 'before', minutes: 1440 },
					{ kind: 'before', minutes: 30 },
				],
			}),
			task('Call mom', { due: { date: '2026-10-14', time: '10:30' } }),
			task('Passport', { reminders: [{ kind: 'at', date: '2026-10-14', time: '12:00' }] }),
			task('Taxes', {
				due: { date: '2026-10-17', time: null },
				reminders: [{ kind: 'at', date: '2026-10-15', time: '09:00' }],
			}),
			task('Rent', {
				due: { date: '2026-10-15', time: null },
				reminders: [{ kind: 'at', date: '2026-10-15', time: '08:00' }],
			}),
			task('Lunch', {
				due: { date: '2026-10-21', time: '12:00' },
				reminders: [{ kind: 'at', date: '2026-10-20', time: '12:00' }],
			}),
		];
		expect(pushSchedule(tasks, NOW)).toEqual([
			{ at: local(2026, 10, 14, 10, 30), taskId: 'Call mom', title: 'Call mom', body: 'Due now' },
			{ at: local(2026, 10, 14, 12), taskId: 'Passport', title: 'Passport', body: 'Reminder' },
			{ at: local(2026, 10, 14, 17), taskId: 'Gym', title: 'Gym', body: 'Due Tomorrow at 5:00 PM' },
			{ at: local(2026, 10, 15, 8), taskId: 'Rent', title: 'Rent', body: 'Due today' },
			{ at: local(2026, 10, 15, 9), taskId: 'Taxes', title: 'Taxes', body: 'Due Sat Oct 17' },
			{ at: local(2026, 10, 15, 16, 30), taskId: 'Gym', title: 'Gym', body: 'Due at 5:00 PM' },
			{ at: local(2026, 10, 15, 17), taskId: 'Gym', title: 'Gym', body: 'Due now' },
			{ at: local(2026, 10, 20, 12), taskId: 'Lunch', title: 'Lunch', body: 'Due Tomorrow at 12:00 PM' },
			{ at: local(2026, 10, 21, 12), taskId: 'Lunch', title: 'Lunch', body: 'Due now' },
		]);
	});

	test('completed tasks, dates without a time, and past moments never notify', () => {
		const tasks = [
			task('Done', { due: { date: '2026-10-14', time: '11:00' }, completedAt: NOW - 1 }),
			task('Taxes', { due: { date: '2026-10-14', time: null } }),
			task('Standup', { due: { date: '2026-10-14', time: '10:15' }, reminders: [{ kind: 'before', minutes: 30 }] }),
			task('Earlier', { due: { date: '2026-10-14', time: '10:00' } }),
		];
		expect(pushSchedule(tasks, NOW)).toEqual([
			{ at: local(2026, 10, 14, 10, 15), taskId: 'Standup', title: 'Standup', body: 'Due now' },
		]);
	});

	test('a reminder at the due time notifies once', () => {
		const tasks = [
			task('Standup', {
				due: { date: '2026-10-14', time: '10:45' },
				reminders: [
					{ kind: 'at', date: '2026-10-14', time: '10:45' },
					{ kind: 'before', minutes: 0 },
				],
			}),
		];
		expect(pushSchedule(tasks, NOW)).toEqual([
			{ at: local(2026, 10, 14, 10, 45), taskId: 'Standup', title: 'Standup', body: 'Due now' },
		]);
	});

	test('a recurring task notifies at its next occurrence once completing moves its due date', () => {
		const water = task('Water plants', {
			due: { date: '2026-10-14', time: '09:00' },
			recurrence: { interval: 2, unit: 'day' },
			reminders: [{ kind: 'before', minutes: 60 }],
		});
		expect(pushSchedule([water], NOW)).toEqual([]);
		const rolled = { ...water, ...nextOccurrence(water, '2026-10-14')! };
		expect(pushSchedule([rolled], NOW)).toEqual([
			{ at: local(2026, 10, 16, 8), taskId: 'Water plants', title: 'Water plants', body: 'Due at 9:00 AM' },
			{ at: local(2026, 10, 16, 9), taskId: 'Water plants', title: 'Water plants', body: 'Due now' },
		]);
	});

	test('keeps only the soonest notifications up to the limit', () => {
		const latest = task('latest', { reminders: [{ kind: 'at', date: '2026-10-16', time: '09:00' }] });
		const sooner = ['a', 'b', 'c'].map(id =>
			task(id, { reminders: [{ kind: 'at', date: '2026-10-15', time: '09:00' }] }),
		);
		expect(upcomingNotifications([latest, ...sooner], NOW, 3).map(n => n.taskId)).toEqual(['a', 'b', 'c']);
	});

	test('titles are cut to 300 characters', () => {
		const long = task('x'.repeat(320), { due: { date: '2026-10-14', time: '11:00' } });
		expect(upcomingNotifications([long], NOW, 500)[0]!.title).toBe('x'.repeat(300));
	});
});

describe('notificationBody', () => {
	test.each([
		['a task with no due date', null, local(2026, 10, 14, 12), 'Reminder'],
		['the due moment', { date: '2026-10-14', time: '17:00' }, local(2026, 10, 14, 17), 'Due now'],
		['earlier the same day', { date: '2026-10-14', time: '17:00' }, local(2026, 10, 14, 16, 30), 'Due at 5:00 PM'],
		['the day before', { date: '2026-10-15', time: '09:00' }, local(2026, 10, 14, 9), 'Due Tomorrow at 9:00 AM'],
		['days before', { date: '2026-10-20', time: '09:00' }, local(2026, 10, 14, 9), 'Due Tue Oct 20 at 9:00 AM'],
		['after the due time', { date: '2026-10-14', time: '09:00' }, local(2026, 10, 14, 9, 30), 'Due at 9:00 AM'],
		['a date with no time, that day', { date: '2026-10-15', time: null }, local(2026, 10, 15, 8), 'Due today'],
		[
			'a date with no time, the day before',
			{ date: '2026-10-15', time: null },
			local(2026, 10, 14, 20),
			'Due tomorrow',
		],
		['a date with no time, the day after', { date: '2026-10-14', time: null }, local(2026, 10, 15, 8), 'Due yesterday'],
		['a date with no time, days before', { date: '2026-10-17', time: null }, local(2026, 10, 15, 9), 'Due Sat Oct 17'],
		['across the DST change', { date: '2026-11-02', time: '09:00' }, local(2026, 11, 1, 8), 'Due Tomorrow at 9:00 AM'],
		['next year', { date: '2027-01-05', time: null }, local(2026, 12, 30, 9), 'Due Tue Jan 5, 2027'],
	] as const)('%s', (_, due, at, expected) => {
		expect(notificationBody(due, at)).toBe(expected);
	});
});
