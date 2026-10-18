import { expect } from 'bun:test';
import * as screens from './screens.ts';
import type { AccessRow } from './db/schema.ts';
import type { Task } from './task.ts';
import type { TaskEvent, TaskLocation } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';
import { task as base } from './testing.ts';

const screenDefaults = recorded('screens', screens.screenDefaults);
const screenHolds = recorded('screens', screens.screenHolds);
const canAddTo = recorded('screens', screens.canAddTo);

const today = '2026-10-14';

/** An `access` row of Ann's space to this user, as the server writes it. */
const granted = (kind: AccessRow['kind'], entityId: string, role: AccessRow['role']): AccessRow => ({
	id: `me:${kind}:${entityId}`,
	grantee: 'me',
	owner: 'ann',
	kind,
	entityId,
	role,
});

let created = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => base(id, { createdAt: ++created, ...fields });

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
		const space = { access: [granted('project', 'garden', 'view'), granted('label', 'weekend', 'view')] };
		expect(screenDefaults({ kind: 'project', id: 'garden', sectionId: 'beds' }, [], space)).toEqual(none);
		expect(screenDefaults({ kind: 'label', id: 'weekend' }, [], space)).toEqual(none);
	});

	test('a shared project or label the user can edit starts on it', () => {
		const space = { access: [granted('project', 'garden', 'edit'), granted('label', 'weekend', 'edit')] };
		expect(screenDefaults({ kind: 'project', id: 'garden' }, [], space)).toEqual({ ...none, projectId: 'garden' });
		expect(screenDefaults({ kind: 'label', id: 'weekend' }, [], space)).toEqual({ ...none, labelId: 'weekend' });
	});
});

describe('canAddTo', () => {
	// Garden is shared to edit, Shed and the Weekend label to view, and Fence is a task shared to edit on its own, so
	// its project is in view only through it.
	const space = {
		access: [
			granted('project', 'garden', 'edit'),
			granted('section', 'beds', 'edit'),
			granted('project', 'shed', 'view'),
			granted('label', 'weekend', 'view'),
			granted('task', 'fence', 'edit'),
			granted('project', 'fence-project', 'view'),
		],
	};

	test('the user’s own lists and the other screens always take a task', () => {
		expect(canAddTo({ kind: 'project', id: 'home' }, null)).toBe(true);
		expect(canAddTo({ kind: 'inbox' }, space)).toBe(true);
		expect(canAddTo(null, space)).toBe(true);
	});

	test('a shared project or label takes a task only when its access row says edit', () => {
		expect(canAddTo({ kind: 'project', id: 'garden' }, space)).toBe(true);
		expect(canAddTo({ kind: 'project', id: 'garden', sectionId: 'beds' }, space)).toBe(true);
		expect(canAddTo({ kind: 'project', id: 'shed' }, space)).toBe(false);
		expect(canAddTo({ kind: 'label', id: 'weekend' }, space)).toBe(false);
		expect(canAddTo({ kind: 'project', id: 'fence-project' }, space)).toBe(false);
	});

	test('a list the rows do not name takes none', () => {
		expect(canAddTo({ kind: 'project', id: 'unknown' }, space)).toBe(false);
		expect(canAddTo({ kind: 'label', id: 'unknown' }, space)).toBe(false);
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
