import { expect } from 'bun:test';
import type { Task } from './task.ts';
import * as triggers from './triggers.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const currentOccurrence = recorded('triggers', triggers.currentOccurrence);
const eventGroups = recorded('triggers', triggers.eventGroups);
const formatEvent = recorded('triggers', triggers.formatEvent);
const formatLocation = recorded('triggers', triggers.formatLocation);
const placeGroups = recorded('triggers', triggers.placeGroups);
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
const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	parentId: null,
	order: 0,
	title: id,
	notes: '',
	projectId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	createdAt: ++created,
	completedAt: null,
	...fields,
});

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
		expect(formatEvent(meetup({ edge: 'after', minutes: 0 }))).toBe('After Walking meetup');
		expect(formatEvent(meetup({ edge: 'after', minutes: 60 }))).toBe('1h after Walking meetup');
	});

	test('places read by trigger', () => {
		expect(formatLocation(park({ trigger: 'arrive' }))).toBe('Arriving at Park');
		expect(formatLocation(park({ trigger: 'leave' }))).toBe('Leaving Park');
		expect(formatLocation(park({ trigger: 'during' }))).toBe('While at Park');
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
		expect(placeGroups(tasks)).toEqual([
			{ key: '52.5200,13.4050', name: 'Park', count: 1 },
			{ key: '52.5000,13.4000', name: 'Rewe', count: 2 },
		]);
		expect(placeGroups([task('plain')])).toEqual([]);
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
