import { expect } from 'bun:test';
import * as filters from './list-filters.ts';
import type { Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';
import { task as base } from './testing.ts';

const filterTasks = recorded('list-filters', filters.filterTasks);
const filterOptions = recorded('list-filters', filters.filterOptions);
const toggleGroup = recorded('list-filters', filters.toggleGroup);
const toggleOption = recorded('list-filters', filters.toggleOption);
const filterActive = recorded('list-filters', filters.filterActive);
const filterKey = recorded('list-filters', filters.filterKey);

const task = (id: string, fields: Partial<Task> = {}): Task => base(id, fields);

const tasks = [
	task('mine', { createdBy: 'me', priority: 1 }),
	task('imported', { createdBy: null, priority: 4 }),
	task('bot-1', { createdBy: 'bot', priority: 1 }),
	task('bot-2', { createdBy: 'bot', priority: 4 }),
	task('ann', { createdBy: 'ann', priority: 2 }),
];

const ids = (list: Task[]) => list.map(t => t.id);

describe('filterTasks', () => {
	test('no filter keeps every task', () => {
		expect(ids(filterTasks(tasks, filters.NO_FILTER, 'me'))).toEqual(['mine', 'imported', 'bot-1', 'bot-2', 'ann']);
	});

	test('a task with no creator is the user’s', () => {
		expect(ids(filterTasks(tasks, { people: ['me'], priorities: null }, 'me'))).toEqual(['mine', 'imported']);
	});

	test('both groups must match', () => {
		expect(ids(filterTasks(tasks, { people: ['me', 'bot'], priorities: [1] }, 'me'))).toEqual(['mine', 'bot-1']);
	});
});

describe('filterOptions', () => {
	test('counts each choice, the user first, then by count', () => {
		expect(filterOptions(tasks, filters.NO_FILTER, 'me')).toEqual({
			people: [
				{ value: 'me', count: 2, selected: false },
				{ value: 'bot', count: 2, selected: false },
				{ value: 'ann', count: 1, selected: false },
			],
			priorities: [
				{ value: 1, count: 2, selected: false },
				{ value: 2, count: 1, selected: false },
				{ value: 4, count: 2, selected: false },
			],
		});
	});

	test('a group counts over what the other group shows', () => {
		expect(filterOptions(tasks, { people: ['bot'], priorities: null }, 'me')).toEqual({
			people: [
				{ value: 'me', count: 2, selected: false },
				{ value: 'bot', count: 2, selected: true },
				{ value: 'ann', count: 1, selected: false },
			],
			priorities: [
				{ value: 1, count: 1, selected: false },
				{ value: 4, count: 1, selected: false },
			],
		});
	});

	test('a picked choice stays while it counts nothing', () => {
		const options = filterOptions(tasks, { people: ['ann'], priorities: [1] }, 'me');
		expect(options.priorities).toEqual([
			{ value: 1, count: 0, selected: true },
			{ value: 2, count: 1, selected: false },
		]);
		expect(options.people).toEqual([
			{ value: 'me', count: 1, selected: false },
			{ value: 'bot', count: 1, selected: false },
			{ value: 'ann', count: 0, selected: true },
		]);
	});

	test('a group with one choice is left out', () => {
		const solo = [task('a', { createdBy: 'me', priority: 4 }), task('b', { createdBy: null, priority: 4 })];
		expect(filterOptions(solo, filters.NO_FILTER, 'me')).toEqual({ people: [], priorities: [] });
	});

	test('a turned-on group stays with one choice, so it can be turned off', () => {
		const solo = [task('a', { createdBy: 'me', priority: 4 })];
		expect(filterOptions(solo, { people: null, priorities: [4] }, 'me').priorities).toEqual([
			{ value: 4, count: 1, selected: true },
		]);
	});
});

describe('toggles', () => {
	test('turning a group on picks every choice it offers', () => {
		const options = filterOptions(tasks, filters.NO_FILTER, 'me');
		expect(toggleGroup(filters.NO_FILTER, 'people', options)).toEqual({
			people: ['me', 'bot', 'ann'],
			priorities: null,
		});
	});

	test('turning a group off shows everything again', () => {
		const filter = { people: ['me'], priorities: [1 as const] };
		expect(toggleGroup(filter, 'people', filterOptions(tasks, filter, 'me'))).toEqual({
			people: null,
			priorities: [1],
		});
	});

	test('picking a choice with the group off shows only it', () => {
		expect(toggleOption(filters.NO_FILTER, 'priorities', 2)).toEqual({ people: null, priorities: [2] });
	});

	test('toggling a picked choice drops it', () => {
		expect(toggleOption({ people: ['me', 'bot'], priorities: null }, 'people', 'bot')).toEqual({
			people: ['me'],
			priorities: null,
		});
	});

	test('dropping the last choice turns the group off', () => {
		expect(toggleOption({ people: null, priorities: [2] }, 'priorities', 2)).toEqual(filters.NO_FILTER);
	});

	test('a filter is active while any group is on', () => {
		expect(filterActive(filters.NO_FILTER)).toBe(false);
		expect(filterActive({ people: null, priorities: [4] })).toBe(true);
	});
});

describe('filterKey', () => {
	test('each list keeps its own, and Inbox’s days share Inbox’s', () => {
		expect(filterKey({ kind: 'inbox', date: '2026-10-15' })).toBe('inbox');
		expect(filterKey({ kind: 'this-week', date: '2026-10-16' })).toBe('this-week');
		expect(filterKey({ kind: 'no-date' })).toBe('no-date');
		expect(filterKey({ kind: 'project', id: 'p1', sectionId: 's1' })).toBe('project:p1');
		expect(filterKey({ kind: 'label', id: 'l1' })).toBe('label:l1');
		expect(filterKey({ kind: 'place', key: '52.5,13.4' })).toBe('place:52.5,13.4');
		expect(filterKey({ kind: 'event', id: 'standup' })).toBe('event:standup');
	});
});
