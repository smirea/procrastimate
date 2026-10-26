import { expect } from 'bun:test';
import * as notifications from './notifications.ts';
import { nextOccurrence, type Task, type TimeOfDay } from './task.ts';
import type { TaskEvent } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const notificationBody = recorded('notifications', notifications.notificationBody);
const upcomingNotifications = recorded('notifications', notifications.upcomingNotifications);
const pushSchedule = (tasks: readonly Task[], now: number) => upcomingNotifications(tasks, now, 500);

const local = (y: number, month: number, d: number, h: number, min = 0) => new Date(y, month - 1, d, h, min).getTime();
const NOW = local(2026, 10, 14, 10);

const task = (id: string, patch: Partial<Task>): Task => ({
	id,
	title: id,
	notes: '',
	projectId: null,
	sectionId: null,
	parentId: null,
	order: 0,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	images: [],
	createdAt: 0,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
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
			{
				at: local(2026, 10, 14, 10, 30),
				title: 'Call mom',
				body: 'Today 10:30 AM',
				opens: { kind: 'task', id: 'Call mom' },
			},
			{ at: local(2026, 10, 14, 12), title: 'Passport', body: 'Reminder', opens: { kind: 'task', id: 'Passport' } },
			{ at: local(2026, 10, 14, 17), title: 'Gym', body: 'Tomorrow 5:00 PM', opens: { kind: 'task', id: 'Gym' } },
			{ at: local(2026, 10, 15, 8), title: 'Rent', body: 'Today', opens: { kind: 'task', id: 'Rent' } },
			{ at: local(2026, 10, 15, 9), title: 'Taxes', body: 'Sat Oct 17', opens: { kind: 'task', id: 'Taxes' } },
			{ at: local(2026, 10, 15, 16, 30), title: 'Gym', body: 'Today 5:00 PM', opens: { kind: 'task', id: 'Gym' } },
			{ at: local(2026, 10, 15, 17), title: 'Gym', body: 'Today 5:00 PM', opens: { kind: 'task', id: 'Gym' } },
			{ at: local(2026, 10, 20, 12), title: 'Lunch', body: 'Tomorrow 12:00 PM', opens: { kind: 'task', id: 'Lunch' } },
			{ at: local(2026, 10, 21, 12), title: 'Lunch', body: 'Today 12:00 PM', opens: { kind: 'task', id: 'Lunch' } },
		]);
	});

	test('an event task names its event, and a due time at a place stays quiet', () => {
		const tasks = [
			task('Wear red', {
				event: {
					id: 'night',
					title: 'Night out',
					allDay: false,
					series: false,
					edge: 'before',
					minutes: 30,
					occurrences: [
						{ start: local(2026, 10, 14, 20), end: local(2026, 10, 14, 23), original: local(2026, 10, 14, 20) },
					],
				},
			}),
			task('Milk', {
				due: { date: '2026-10-14', time: '17:00' },
				location: { name: 'Rewe', address: null, latitude: 52.5, longitude: 13.4, radius: 150, trigger: 'arrive' },
			}),
		];
		expect(pushSchedule(tasks, NOW)).toEqual([
			{
				at: local(2026, 10, 14, 19, 30),
				title: 'Wear red',
				body: '30m before Night out',
				opens: { kind: 'task', id: 'Wear red' },
			},
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
			{
				at: local(2026, 10, 14, 10, 15),
				title: 'Standup',
				body: 'Today 10:15 AM',
				opens: { kind: 'task', id: 'Standup' },
			},
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
			{
				at: local(2026, 10, 14, 10, 45),
				title: 'Standup',
				body: 'Today 10:45 AM',
				opens: { kind: 'task', id: 'Standup' },
			},
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
			{
				at: local(2026, 10, 16, 8),
				title: 'Water plants',
				body: 'Today 9:00 AM',
				opens: { kind: 'task', id: 'Water plants' },
			},
			{
				at: local(2026, 10, 16, 9),
				title: 'Water plants',
				body: 'Today 9:00 AM',
				opens: { kind: 'task', id: 'Water plants' },
			},
		]);
	});

	test('keeps only the soonest notifications up to the limit', () => {
		const latest = task('latest', { reminders: [{ kind: 'at', date: '2026-10-16', time: '09:00' }] });
		const sooner = (['09:00', '09:01', '09:02'] as const).map((time, i) =>
			task('abc'[i] ?? '', { reminders: [{ kind: 'at', date: '2026-10-15', time }] }),
		);
		expect(upcomingNotifications([latest, ...sooner], NOW, 3).map(n => n.title)).toEqual(['a', 'b', 'c']);
	});

	test('tasks at one moment share a notification that counts them, lists three, and opens their place', () => {
		const austin = { name: 'Austin', address: null, latitude: 30.2672, longitude: -97.7431, radius: 2000 } as const;
		const reminders = [{ kind: 'at', date: '2026-10-14', time: '18:00' }] as const;
		const tasks = ['Gun courses', 'Yoga maybe', 'Give timeleft another shot', 'Setup arcade'].map(title =>
			task(title, { reminders: [...reminders], location: { ...austin, trigger: 'arrive' } }),
		);
		expect(pushSchedule(tasks, NOW)).toEqual([
			{
				at: local(2026, 10, 14, 18),
				title: '4 tasks at Austin',
				body: 'Gun courses, Yoga maybe, Give timeleft another shot, and 1 more',
				opens: { kind: 'place', id: '30.2672,-97.7431' },
			},
		]);
	});

	test('a group opens the event, else the project, else Inbox that its tasks share', () => {
		const event: TaskEvent = {
			id: 'night',
			title: 'Night out',
			allDay: false,
			series: false,
			edge: 'start',
			minutes: 0,
			occurrences: [
				{ start: local(2026, 10, 14, 20), end: local(2026, 10, 14, 23), original: local(2026, 10, 14, 20) },
			],
		};
		const at = (time: TimeOfDay) => ({ due: { date: '2026-10-15' as const, time } });
		const tasks = [
			task('Wear red', { event }),
			task('Bring cash', { event }),
			task('Draft', { ...at('09:00'), projectId: 'work' }),
			task('Review', { ...at('09:00'), projectId: 'work' }),
			task('Call mom', at('12:00')),
			task('Lunch', { ...at('12:00'), projectId: 'work' }),
		];
		expect(pushSchedule(tasks, NOW)).toEqual([
			{
				at: local(2026, 10, 14, 20),
				title: '2 tasks for Night out',
				body: 'Wear red, Bring cash',
				opens: { kind: 'event', id: 'night' },
			},
			{ at: local(2026, 10, 15, 9), title: '2 tasks', body: 'Draft, Review', opens: { kind: 'project', id: 'work' } },
			{ at: local(2026, 10, 15, 12), title: '2 tasks', body: 'Call mom, Lunch', opens: { kind: 'inbox', id: '' } },
		]);
	});

	test('titles are cut to 300 characters', () => {
		const long = task('x'.repeat(320), { due: { date: '2026-10-14', time: '11:00' } });
		expect(upcomingNotifications([long], NOW, 500)[0]!.title).toBe('x'.repeat(300));
	});
});

describe('notificationBody', () => {
	test.each([
		['a task with no due date', null, local(2026, 10, 14, 12), 'Reminder'],
		['the due moment', { date: '2026-10-14', time: '17:00' }, local(2026, 10, 14, 17), 'Today 5:00 PM'],
		['earlier the same day', { date: '2026-10-14', time: '17:00' }, local(2026, 10, 14, 16, 30), 'Today 5:00 PM'],
		['the day before', { date: '2026-10-15', time: '09:00' }, local(2026, 10, 14, 9), 'Tomorrow 9:00 AM'],
		['days before', { date: '2026-10-20', time: '09:00' }, local(2026, 10, 14, 9), 'Tue Oct 20 9:00 AM'],
		['after the due time', { date: '2026-10-14', time: '09:00' }, local(2026, 10, 14, 9, 30), 'Today 9:00 AM'],
		['a date with no time, that day', { date: '2026-10-15', time: null }, local(2026, 10, 15, 8), 'Today'],
		['a date with no time, the day before', { date: '2026-10-15', time: null }, local(2026, 10, 14, 20), 'Tomorrow'],
		['a date with no time, the day after', { date: '2026-10-14', time: null }, local(2026, 10, 15, 8), 'Yesterday'],
		['a date with no time, days before', { date: '2026-10-17', time: null }, local(2026, 10, 15, 9), 'Sat Oct 17'],
		['across the DST change', { date: '2026-11-02', time: '09:00' }, local(2026, 11, 1, 8), 'Tomorrow 9:00 AM'],
		['next year', { date: '2027-01-05', time: null }, local(2026, 12, 30, 9), 'Tue Jan 5, 2027'],
	] as const)('%s', (_, due, at, expected) => {
		expect(notificationBody(due, at)).toBe(expected);
	});
});

describe('caughtUpNotification', () => {
	test('folds every moment since the last check into one, at the latest', () => {
		const tasks = [
			task('Pack', { due: { date: '2026-10-14', time: '11:00' }, reminders: [{ kind: 'before', minutes: 60 }] }),
			task('Call mom', { due: { date: '2026-10-14', time: '11:30' } }),
			task('Later', { due: { date: '2026-10-14', time: '13:00' } }),
		];
		const at = local(2026, 10, 14, 12);
		expect(notifications.caughtUpNotification(tasks, NOW - 1, at)).toEqual({
			at: local(2026, 10, 14, 11, 30),
			title: '2 tasks',
			body: 'Pack, Call mom',
			opens: { kind: 'inbox', id: '' },
		});
		expect(notifications.caughtUpNotification(tasks.slice(0, 1), NOW - 1, at)).toEqual({
			at: local(2026, 10, 14, 11),
			title: 'Pack',
			body: 'Today 11:00 AM',
			opens: { kind: 'task', id: 'Pack' },
		});
		expect(notifications.caughtUpNotification(tasks, at, at + 60_000)).toBeNull();
	});
});
