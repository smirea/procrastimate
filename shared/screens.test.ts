import { expect } from 'bun:test';
import * as screens from './screens.ts';
import type { Task } from './task.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const screenDefaults = recorded('screens', screens.screenDefaults);
const screenHolds = recorded('screens', screens.screenHolds);
const canAddTo = recorded('screens', screens.canAddTo);

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
		expect(screenDefaults({ kind: 'inbox', date: '2026-10-15' }, [], null)).toEqual({ ...none, date: '2026-10-15' });
	});

	test('Inbox, No date, Completed, and no screen add a bare task', () => {
		expect(screenDefaults({ kind: 'inbox' }, [], null)).toEqual(none);
		expect(screenDefaults({ kind: 'no-date' }, [], null)).toEqual(none);
		expect(screenDefaults({ kind: 'completed' }, [], null)).toEqual(none);
		expect(screenDefaults(null, [], null)).toEqual(none);
	});

	test('a project starts in the project, and in the section quick add opened from', () => {
		expect(screenDefaults({ kind: 'project', id: 'home' }, [], null)).toEqual({ ...none, projectId: 'home' });
		expect(screenDefaults({ kind: 'project', id: 'home', sectionId: 'kitchen' }, [], null)).toEqual({
			...none,
			projectId: 'home',
			sectionId: 'kitchen',
		});
	});

	test('a label starts with the label', () => {
		expect(screenDefaults({ kind: 'label', id: 'errands' }, [], null)).toEqual({ ...none, labelId: 'errands' });
	});

	test('a place starts at the place, as its earliest open task names it', () => {
		const tasks = [
			task('done', { location: rewe('Old name'), completedAt: 1 }),
			task('first', { location: rewe('Rewe') }),
			task('second', { location: rewe('Supermarket') }),
		];
		expect(screenDefaults({ kind: 'place', key: reweKey }, tasks, null)).toEqual({ ...none, location: rewe('Rewe') });
	});

	test('an event starts on the event, as its earliest open task follows it', () => {
		const tasks = [task('first', { event: standup(15) }), task('second', { event: standup(5) })];
		expect(screenDefaults({ kind: 'event', id: 'standup' }, tasks, null)).toEqual({ ...none, event: standup(15) });
	});

	test('a place or event whose tasks are all done keeps the latest done copy', () => {
		const tasks = [
			task('older', { location: rewe('Old name'), event: standup(5), completedAt: 1 }),
			task('newer', { location: rewe('Rewe'), event: standup(0), completedAt: 2 }),
		];
		expect(screenDefaults({ kind: 'place', key: reweKey }, tasks, null)).toEqual({ ...none, location: rewe('Rewe') });
		expect(screenDefaults({ kind: 'event', id: 'standup' }, tasks, null)).toEqual({ ...none, event: standup(0) });
	});

	test('a place or event no task holds starts bare', () => {
		expect(screenDefaults({ kind: 'place', key: reweKey }, [], null)).toEqual(none);
		expect(screenDefaults({ kind: 'event', id: 'standup' }, [], null)).toEqual(none);
	});

	test('a shared project or label the user can only view starts bare', () => {
		const space = {
			targets: [
				{ kind: 'project', id: 'garden', role: 'view' },
				{ kind: 'label', id: 'weekend', role: 'view' },
			],
		} as const;
		expect(screenDefaults({ kind: 'project', id: 'garden', sectionId: 'beds' }, [], space)).toEqual(none);
		expect(screenDefaults({ kind: 'label', id: 'weekend' }, [], space)).toEqual(none);
	});

	test('a shared project or label the user can edit starts on it', () => {
		const space = {
			targets: [
				{ kind: 'project', id: 'garden', role: 'edit' },
				{ kind: 'label', id: 'weekend', role: 'edit' },
			],
		} as const;
		expect(screenDefaults({ kind: 'project', id: 'garden' }, [], space)).toEqual({ ...none, projectId: 'garden' });
		expect(screenDefaults({ kind: 'label', id: 'weekend' }, [], space)).toEqual({ ...none, labelId: 'weekend' });
	});
});

describe('canAddTo', () => {
	const space = {
		targets: [
			{ kind: 'project', id: 'garden', role: 'edit' },
			{ kind: 'project', id: 'shed', role: 'view' },
			{ kind: 'label', id: 'weekend', role: 'view' },
			{ kind: 'task', id: 'fence', role: 'edit' },
		],
	} as const;

	test('the user’s own lists and the other screens always take a task', () => {
		expect(canAddTo({ kind: 'project', id: 'home' }, null)).toBe(true);
		expect(canAddTo({ kind: 'inbox' }, space)).toBe(true);
		expect(canAddTo(null, space)).toBe(true);
	});

	test('a shared project or label takes a task only through an edit share on it', () => {
		expect(canAddTo({ kind: 'project', id: 'garden' }, space)).toBe(true);
		expect(canAddTo({ kind: 'project', id: 'shed' }, space)).toBe(false);
		expect(canAddTo({ kind: 'label', id: 'weekend' }, space)).toBe(false);
		expect(canAddTo({ kind: 'project', id: 'fence-project' }, space)).toBe(false);
	});

	test('an edit share on the whole space takes a task on any of its lists', () => {
		const managed = { targets: [{ kind: 'space', id: '', role: 'edit' }] } as const;
		expect(canAddTo({ kind: 'project', id: 'shed' }, managed)).toBe(true);
		expect(canAddTo({ kind: 'label', id: 'weekend' }, managed)).toBe(true);
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
