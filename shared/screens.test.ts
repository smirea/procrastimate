import { expect } from 'bun:test';
import * as screens from './screens.ts';
import type { Task } from './task.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const screenDefaults = recorded('screens', screens.screenDefaults);
const screenHolds = recorded('screens', screens.screenHolds);

const today = '2026-10-14';

let created = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	parentId: null,
	order: 0,
	title: id,
	notes: '',
	projectId: null,
	sectionId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	images: [],
	createdAt: ++created,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
	...fields,
});

const rewe = (name: string): TaskLocation => ({
	name,
	address: null,
	latitude: 52.5,
	longitude: 13.4,
	radius: 150,
	trigger: 'arrive',
});
const reweKey = '52.5000,13.4000';
const standup = (minutes: number): TaskEvent => ({
	id: 'standup',
	title: 'Standup',
	allDay: false,
	series: true,
	edge: 'before',
	minutes,
	occurrences: [{ start: 1791990000000, end: 1791991800000, original: 1791990000000 }],
});

const none = {
	projectId: null,
	sectionId: null,
	labelId: null,
	location: null,
	event: null,
	date: null,
};

describe('screenDefaults', () => {
	test('an Inbox day heading starts on its day', () => {
		expect(screenDefaults({ kind: 'inbox', date: '2026-10-15' }, [])).toEqual({ ...none, date: '2026-10-15' });
	});

	test('Inbox, No date, Completed, and no screen add a bare task', () => {
		expect(screenDefaults({ kind: 'inbox' }, [])).toEqual(none);
		expect(screenDefaults({ kind: 'no-date' }, [])).toEqual(none);
		expect(screenDefaults({ kind: 'completed' }, [])).toEqual(none);
		expect(screenDefaults(null, [])).toEqual(none);
	});

	test('a project starts in the project, and in the section quick add opened from', () => {
		expect(screenDefaults({ kind: 'project', id: 'home' }, [])).toEqual({ ...none, projectId: 'home' });
		expect(screenDefaults({ kind: 'project', id: 'home', sectionId: 'kitchen' }, [])).toEqual({
			...none,
			projectId: 'home',
			sectionId: 'kitchen',
		});
	});

	test('a label starts with the label', () => {
		expect(screenDefaults({ kind: 'label', id: 'errands' }, [])).toEqual({ ...none, labelId: 'errands' });
	});

	test('a place starts at the place, as its earliest open task names it', () => {
		const tasks = [
			task('done', { location: rewe('Old name'), completedAt: 1 }),
			task('first', { location: rewe('Rewe') }),
			task('second', { location: rewe('Supermarket') }),
		];
		expect(screenDefaults({ kind: 'place', key: reweKey }, tasks)).toEqual({ ...none, location: rewe('Rewe') });
	});

	test('an event starts on the event, as its earliest open task follows it', () => {
		const tasks = [task('first', { event: standup(15) }), task('second', { event: standup(5) })];
		expect(screenDefaults({ kind: 'event', id: 'standup' }, tasks)).toEqual({ ...none, event: standup(15) });
	});

	test('a place or event whose tasks are all done keeps the latest done copy', () => {
		const tasks = [
			task('older', { location: rewe('Old name'), event: standup(5), completedAt: 1 }),
			task('newer', { location: rewe('Rewe'), event: standup(0), completedAt: 2 }),
		];
		expect(screenDefaults({ kind: 'place', key: reweKey }, tasks)).toEqual({ ...none, location: rewe('Rewe') });
		expect(screenDefaults({ kind: 'event', id: 'standup' }, tasks)).toEqual({ ...none, event: standup(0) });
	});

	test('a place or event no task holds starts bare', () => {
		expect(screenDefaults({ kind: 'place', key: reweKey }, [])).toEqual(none);
		expect(screenDefaults({ kind: 'event', id: 'standup' }, [])).toEqual(none);
	});
});

describe('screenHolds', () => {
	test('Inbox holds dated tasks from any project', () => {
		expect(
			screenHolds({ kind: 'inbox' }, task('a', { due: { date: today, time: null }, projectId: 'home' }), today),
		).toBe(true);
		expect(screenHolds({ kind: 'inbox' }, task('b'), today)).toBe(false);
	});

	test('No date holds undated tasks in no project', () => {
		expect(screenHolds({ kind: 'no-date' }, task('a'), today)).toBe(true);
		expect(screenHolds({ kind: 'no-date' }, task('b', { projectId: 'home' }), today)).toBe(false);
		expect(screenHolds({ kind: 'no-date' }, task('c', { due: { date: today, time: null } }), today)).toBe(false);
	});

	test('a project, label, place, or event holds the tasks it lists', () => {
		const t = task('a', { projectId: 'home', labelIds: ['errands'], location: rewe('Rewe'), event: standup(0) });
		expect(screenHolds({ kind: 'project', id: 'home' }, t, today)).toBe(true);
		expect(screenHolds({ kind: 'project', id: 'work' }, t, today)).toBe(false);
		expect(screenHolds({ kind: 'label', id: 'errands' }, t, today)).toBe(true);
		expect(screenHolds({ kind: 'place', key: reweKey }, t, today)).toBe(true);
		expect(screenHolds({ kind: 'place', key: '0.0000,0.0000' }, t, today)).toBe(false);
		expect(screenHolds({ kind: 'event', id: 'standup' }, t, today)).toBe(true);
	});

	test('Completed and no screen hold no new task', () => {
		expect(screenHolds({ kind: 'completed' }, task('a'), today)).toBe(false);
		expect(screenHolds(null, task('a'), today)).toBe(false);
	});
});
