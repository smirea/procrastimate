import { expect } from 'bun:test';
import type { Label, Task } from './task.ts';
import * as triggers from './triggers.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';
import { task as base } from './testing.ts';

const currentOccurrence = recorded('triggers', triggers.currentOccurrence);
const eventGroups = recorded('triggers', triggers.eventGroups);
const eventLabel = recorded('triggers', triggers.eventLabel);
const formatEvent = recorded('triggers', triggers.formatEvent);
const formatLocation = recorded('triggers', triggers.formatLocation);
const formatRadius = recorded('triggers', triggers.formatRadius);
const placeGroups = recorded('triggers', triggers.placeGroups);
const placeLocation = recorded('triggers', triggers.placeLocation);
const pickedLabels = recorded('triggers', triggers.pickedLabels);
const applyPickedLabels = recorded('triggers', triggers.applyPickedLabels);
const savedPlaceAt = recorded('triggers', triggers.savedPlaceAt);
const scheduledDue = recorded('triggers', triggers.scheduledDue);
const taskNotificationTimes = recorded('triggers', triggers.taskNotificationTimes);

const local = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).getTime();
const today = '2026-10-14' as const;

const meetup = (patch: Partial<TaskEvent> = {}): TaskEvent => ({
	id: 'meetup',
	title: 'Walking meetup',
	allDay: false,
	series: false,
	edge: 'start',
	minutes: 0,
	occurrences: [{ start: local(14, 18), end: local(14, 19, 30), original: local(14, 18) }],
	...patch,
});

const park = (patch: Partial<TaskLocation> = {}): TaskLocation => ({
	name: 'Park',
	address: null,
	latitude: 52.52,
	longitude: 13.405,
	radius: 150,
	trigger: 'during',
	...patch,
});

let created = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => base(id, { createdAt: ++created, ...fields });

describe('scheduledDue', () => {
	test('an event task sits on its edge', () => {
		expect(scheduledDue(task('a', { event: meetup({ edge: 'before', minutes: 30 }) }), today)).toEqual({
			date: today,
			time: '17:30',
		});
		expect(scheduledDue(task('b', { event: meetup({ edge: 'after', minutes: 60 }) }), today)).toEqual({
			date: today,
			time: '20:30',
		});
		expect(scheduledDue(task('c', { event: meetup({ allDay: true }) }), today)).toEqual({ date: today, time: null });
		expect(scheduledDue(task('d', { event: meetup({ edge: 'beforeEnd', minutes: 15 }) }), today)).toEqual({
			date: today,
			time: '19:15',
		});
	});

	test('a day before an all-day stay ends lands on the day before its last day', () => {
		const stay = meetup({
			allDay: true,
			edge: 'beforeEnd',
			minutes: 1440,
			occurrences: [{ start: local(14, 0), end: local(18, 23, 59) + 59_000, original: local(14, 0) }],
		});
		expect(scheduledDue(task('a', { event: stay }), today)).toEqual({ date: '2026-10-17', time: null });
		expect(scheduledDue(task('b', { event: { ...stay, minutes: 300 } }), today)).toEqual({
			date: '2026-10-18',
			time: null,
		});
	});

	test('days of offset on an all-day event step calendar days across a daylight saving change', () => {
		const zone = 'America/New_York';
		const fallBack = meetup({
			allDay: true,
			edge: 'beforeEnd',
			minutes: 1440,
			occurrences: [{ start: Date.UTC(2026, 9, 30, 4), end: Date.UTC(2026, 10, 2, 4, 59, 59), original: 0 }],
		});
		expect(scheduledDue(task('a', { event: fallBack }), today, zone)).toEqual({ date: '2026-10-31', time: null });
		const springForward = meetup({
			allDay: true,
			edge: 'before',
			minutes: 1440,
			occurrences: [{ start: Date.UTC(2026, 2, 9, 4), end: Date.UTC(2026, 2, 10, 3, 59, 59), original: 0 }],
		});
		expect(scheduledDue(task('b', { event: springForward }), today, zone)).toEqual({ date: '2026-03-08', time: null });
		const start = { ...springForward, edge: 'start' as const };
		expect(scheduledDue(task('c', { event: start }), today, zone)).toEqual({ date: '2026-03-09', time: null });
	});

	test('a single event stays on its passed occurrence, so it goes overdue', () => {
		const event = meetup({ occurrences: [{ start: local(12, 18), end: local(12, 19), original: local(12, 18) }] });
		expect(scheduledDue(task('a', { event }), today)).toEqual({ date: '2026-10-12', time: '18:00' });
	});

	test('a series skips occurrences whose day is over but keeps one earlier today', () => {
		const event = meetup({
			series: true,
			occurrences: [
				{ start: local(7, 18), end: local(7, 19), original: local(7, 18) },
				{ start: local(14, 8), end: local(14, 9), original: local(14, 8) },
				{ start: local(21, 18), end: local(21, 19), original: local(21, 18) },
			],
		});
		expect(currentOccurrence(event, today)).toEqual({ start: local(14, 8), end: local(14, 9), original: local(14, 8) });
		expect(currentOccurrence(event, '2026-10-15')).toEqual({
			start: local(21, 18),
			end: local(21, 19),
			original: local(21, 18),
		});
	});

	test('a repeat at a place skips missed occurrences, and a single one at a place stays overdue', () => {
		const due = { date: '2026-10-09' as const, time: '09:00' as const };
		const recurrence = { interval: 1, unit: 'week' as const };
		expect(scheduledDue(task('weekly', { due, recurrence, location: park() }), today)).toEqual({
			date: '2026-10-16',
			time: '09:00',
		});
		expect(scheduledDue(task('once', { due, location: park() }), today)).toEqual(due);
		expect(scheduledDue(task('no place', { due, recurrence }), today)).toEqual(due);
	});
});

describe('taskNotificationTimes', () => {
	test('an event notifies at its moment, and relative reminders count back from it', () => {
		const event = meetup({ edge: 'before', minutes: 30 });
		expect(taskNotificationTimes(task('a', { event, reminders: [{ kind: 'before', minutes: 10 }] }), today)).toEqual([
			new Date(local(14, 17, 20)),
			new Date(local(14, 17, 30)),
		]);
	});

	test('an event that ends notifies before its end', () => {
		const event = meetup({
			edge: 'beforeEnd',
			minutes: 300,
			occurrences: [{ start: local(14, 9), end: local(14, 22), original: local(14, 9) }],
		});
		expect(taskNotificationTimes(task('a', { event }), today)).toEqual([new Date(local(14, 17))]);
	});

	test('a series notifies at every listed occurrence, and an all-day event only at its reminders', () => {
		const series = meetup({
			series: true,
			edge: 'after',
			occurrences: [
				{ start: local(14, 18), end: local(14, 19), original: local(14, 18) },
				{ start: local(21, 18), end: local(21, 19), original: local(21, 18) },
			],
		});
		expect(taskNotificationTimes(task('a', { event: series }), today)).toEqual([
			new Date(local(14, 19)),
			new Date(local(21, 19)),
		]);
		const allDay = meetup({
			allDay: true,
			occurrences: [{ start: local(15, 0), end: local(16, 0), original: local(15, 0) }],
		});
		expect(
			taskNotificationTimes(
				task('b', { event: allDay, reminders: [{ kind: 'at', date: '2026-10-15', time: '08:00' }] }),
				today,
			),
		).toEqual([new Date(local(15, 8))]);
	});

	test('a due time at a place does not notify, but its reminders do', () => {
		const due = { date: today, time: '17:00' as const };
		expect(taskNotificationTimes(task('a', { due, location: park() }), today)).toEqual([]);
		expect(
			taskNotificationTimes(task('b', { due, location: park(), reminders: [{ kind: 'before', minutes: 60 }] }), today),
		).toEqual([new Date(local(14, 16))]);
	});
});

describe('labels', () => {
	test('events read by edge', () => {
		expect(formatEvent(meetup({ edge: 'before', minutes: 30 }))).toBe('30m before Walking meetup');
		expect(formatEvent(meetup({ edge: 'start' }))).toBe('When Walking meetup starts');
		expect(formatEvent(meetup({ edge: 'during' }))).toBe('During Walking meetup');
		expect(formatEvent(meetup({ edge: 'beforeEnd', minutes: 1440 }))).toBe('1d before Walking meetup ends');
		expect(formatEvent(meetup({ edge: 'beforeEnd', minutes: 0 }))).toBe('When Walking meetup ends');
		expect(formatEvent(meetup({ edge: 'after', minutes: 0 }))).toBe('After Walking meetup');
		expect(formatEvent(meetup({ edge: 'after', minutes: 60 }))).toBe('1h after Walking meetup');
	});

	test("a row names the task's moment with only the day and time today leaves ambiguous", () => {
		const on = (d: number, h: number, min = 0) => [
			{ start: local(d, h, min), end: local(d, h + 1), original: local(d, h, min) },
		];
		expect(eventLabel(meetup({ edge: 'after', minutes: 15, occurrences: on(14, 15) }), today)).toEqual({
			lead: '15m after',
			title: 'Walking meetup',
			trail: null,
			when: '4:15pm',
		});
		expect(eventLabel(meetup({ edge: 'beforeEnd', minutes: 300, occurrences: on(14, 21) }), today)).toEqual({
			lead: '5h before',
			title: 'Walking meetup',
			trail: 'ends',
			when: '5pm',
		});
		expect(eventLabel(meetup({ edge: 'beforeEnd', occurrences: on(14, 21) }), today)).toEqual({
			lead: 'End of',
			title: 'Walking meetup',
			trail: null,
			when: '10pm',
		});
		expect(eventLabel(meetup({ edge: 'before', minutes: 60, occurrences: on(20, 9, 30) }), today).when).toBe(
			'Tuesday 8:30am',
		);
		expect(eventLabel(meetup({ occurrences: on(21, 18) }), today)).toEqual({
			lead: 'Start of',
			title: 'Walking meetup',
			trail: null,
			when: 'Oct 21 6pm',
		});
		expect(eventLabel(meetup({ edge: 'during', occurrences: on(12, 18) }), today).when).toBe('Oct 12 6pm');
		expect(eventLabel(meetup({ allDay: true, occurrences: on(14, 0) }), today).when).toBeNull();
		expect(eventLabel(meetup({ allDay: true, occurrences: on(16, 0) }), today).when).toBe('Friday');
		expect(eventLabel(meetup({ occurrences: on(14, 18) }), '2025-12-30').when).toBe('Oct 14, 2026 6pm');
	});

	test('a task that follows a series reads the occurrence it is on', () => {
		const series = meetup({
			series: true,
			edge: 'after',
			minutes: 0,
			occurrences: [
				{ start: local(13, 10), end: local(13, 11), original: local(13, 10) },
				{ start: local(15, 10), end: local(15, 11), original: local(15, 10) },
			],
		});
		expect(eventLabel(series, today)).toEqual({
			lead: 'After',
			title: 'Walking meetup',
			trail: null,
			when: 'Tomorrow 11am',
		});
	});

	test('places read by trigger', () => {
		expect(formatLocation(park({ trigger: 'arrive' }))).toBe('Arriving at Park');
		expect(formatLocation(park({ trigger: 'leave' }))).toBe('Leaving Park');
		expect(formatLocation(park({ trigger: 'during' }))).toBe('While at Park');
	});

	test('radii read in meters below a kilometer, then kilometers', () => {
		expect(formatRadius(150)).toBe('150 m');
		expect(formatRadius(994)).toBe('990 m');
		expect(formatRadius(996)).toBe('1 km');
		expect(formatRadius(1250)).toBe('1.3 km');
		expect(formatRadius(1480)).toBe('1.5 km');
		expect(formatRadius(9960)).toBe('10 km');
		expect(formatRadius(21_920)).toBe('22 km');
		expect(formatRadius(100_000)).toBe('100 km');
	});
});

const home: Label = {
	id: 'l-home',
	name: 'Home',
	color: 'green',
	place: { address: 'Parkweg 1', latitude: 52.52001, longitude: 13.40501, radius: 500 },
	createdAt: 1,
};

describe('saved places', () => {
	test('a saved place is found by its spot', () => {
		const calls: Label = { id: 'l-calls', name: 'calls', color: 'blue', place: null, createdAt: 1 };
		expect(savedPlaceAt([calls, home], '52.5200,13.4050')?.id).toBe('l-home');
		expect(savedPlaceAt([calls, home], '52.5000,13.4000')).toBeNull();
	});

	test('a saved place becomes a task place under its name and radius', () => {
		expect(placeLocation(home as triggers.SavedPlaceLabel, 'leave')).toEqual({
			name: 'Home',
			address: 'Parkweg 1',
			latitude: 52.52001,
			longitude: 13.40501,
			radius: 500,
			trigger: 'leave',
		});
	});
});

describe('label pickers', () => {
	const calls: Label = { id: 'l-calls', name: 'calls', color: 'blue', place: null, createdAt: 1 };
	const gym: Label = { ...home, id: 'l-gym', name: 'Gym', place: { ...home.place!, latitude: 52.4 } };
	const labels = [calls, home, gym];

	test('a task at a saved place shows it checked after its labels', () => {
		expect(pickedLabels(labels, { labelIds: ['l-calls'], location: park({ trigger: 'leave' }) })).toEqual([
			'l-calls',
			'l-home',
		]);
		expect(pickedLabels(labels, { labelIds: ['l-calls'], location: park({ latitude: 40 }) })).toEqual(['l-calls']);
	});

	test('checking a saved place sets it as the place, keeping the trigger, and the last one checked wins', () => {
		const leaving = park({ name: 'Elsewhere', latitude: 40, trigger: 'leave' });
		expect(applyPickedLabels(labels, ['l-home', 'l-calls', 'l-gym'], leaving)).toEqual({
			labelIds: ['l-calls'],
			location: {
				name: 'Gym',
				address: 'Parkweg 1',
				latitude: 52.4,
				longitude: 13.40501,
				radius: 500,
				trigger: 'leave',
			},
		});
		expect(applyPickedLabels(labels, ['l-home'], null).location?.trigger).toBe('arrive');
	});

	test('unchecking the saved place clears it, while a place never saved stays', () => {
		expect(applyPickedLabels(labels, ['l-calls'], park())).toEqual({ labelIds: ['l-calls'], location: null });
		const rewe = park({ name: 'Rewe', latitude: 40 });
		expect(applyPickedLabels(labels, [], rewe)).toEqual({ labelIds: [], location: rewe });
	});
});

describe('sidebar groups', () => {
	test('places group open tasks by spot, named after the earliest task', () => {
		const tasks = [
			task('milk', { location: park({ name: 'Rewe', latitude: 52.5, longitude: 13.4, trigger: 'arrive' }) }),
			task('eggs', { location: park({ name: 'Supermarket', latitude: 52.50001, longitude: 13.40001 }) }),
			task('jan', { location: park() }),
			task('done', { location: park(), completedAt: 1 }),
			task('plain'),
		];
		expect(placeGroups(tasks, [])).toEqual([
			{ key: '52.5200,13.4050', name: 'Park', count: 1 },
			{ key: '52.5000,13.4000', name: 'Rewe', count: 2 },
		]);
		expect(placeGroups([task('plain')], [])).toEqual([]);
		expect(placeGroups(tasks, [home])).toEqual([{ key: '52.5000,13.4000', name: 'Rewe', count: 2 }]);
	});

	test('events group open tasks by event, soonest first', () => {
		const later = meetup({
			id: 'night',
			title: 'Night out',
			occurrences: [{ start: local(16, 20), end: local(16, 23), original: local(16, 20) }],
		});
		const tasks = [
			task('red', { event: later }),
			task('jan', { event: meetup() }),
			task('notes', { event: meetup({ edge: 'after' }) }),
		];
		expect(eventGroups(tasks, today)).toEqual([
			{ id: 'meetup', title: 'Walking meetup', count: 2 },
			{ id: 'night', title: 'Night out', count: 1 },
		]);
	});
});
