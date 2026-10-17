import { expect } from 'bun:test';
import * as actions from './row-actions.ts';
import type { Task } from './task.ts';
import type { TaskEvent } from './values.ts';
import { describe, recorded, test } from './vectors/record.ts';

const rowActions = recorded('row-actions', actions.rowActions);

const task = (fields: Partial<Task> = {}): Task => ({
	id: 'milk',
	parentId: null,
	order: 0,
	title: 'Buy milk',
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
	createdAt: 1,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
	...fields,
});

const standup: TaskEvent = {
	id: 'standup',
	title: 'Standup',
	allDay: false,
	series: true,
	edge: 'before',
	minutes: 10,
	occurrences: [{ start: 1791990000000, end: 1791991800000, original: 1791990000000 }],
};

describe('rowActions', () => {
	test('an open task offers Complete, Postpone, and Delete', () => {
		expect(rowActions(task(), false)).toEqual({ toggle: 'complete', postpone: true, delete: true });
	});

	test('a completed task offers Reopen and Delete, with nothing to postpone', () => {
		expect(rowActions(task({ completedAt: 2 }), false)).toEqual({ toggle: 'reopen', postpone: false, delete: true });
	});

	test('a task on an event follows the event, so it never postpones', () => {
		expect(rowActions(task({ event: standup }), false)).toEqual({ toggle: 'complete', postpone: false, delete: true });
	});

	test('a task the user may only view offers only Copy', () => {
		const none = { toggle: null, postpone: false, delete: false };
		expect(rowActions(task(), true)).toEqual(none);
		expect(rowActions(task({ completedAt: 2 }), true)).toEqual(none);
	});

	test('a repeating task’s past completion offers only Copy, since the task is still open', () => {
		const roll = task({
			due: { date: '2026-10-15', time: null },
			recurrence: { unit: 'day', interval: 1 },
			lastCompletedAt: 2,
		});
		expect(rowActions(roll, false, true)).toEqual({ toggle: null, postpone: false, delete: false });
	});
});
