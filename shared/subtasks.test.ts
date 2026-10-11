import { expect } from 'bun:test';
import * as subtasks from './subtasks.ts';
import type { Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const ancestorsOf = recorded('subtasks', subtasks.ancestorsOf);
const completeTask = recorded('subtasks', subtasks.completeTask);
const descendantsOf = recorded('subtasks', subtasks.descendantsOf);
const detachOrphans = recorded('subtasks', subtasks.detachOrphans);
const groupChildren = recorded('subtasks', subtasks.groupChildren);
const moveSubtask = recorded('subtasks', subtasks.moveSubtask);
const nextSiblingOrder = recorded('subtasks', subtasks.nextSiblingOrder);
const progressOf = recorded('subtasks', subtasks.progressOf);
const reopenTask = recorded('subtasks', subtasks.reopenTask);

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
	createdAt: 1,
	completedAt: null,
	...fields,
});

/** Trip has Passport, Charger, and Socks in that order. Charger has Cable under it. */
const trip = () => [
	task('trip'),
	task('socks', { parentId: 'trip', order: 2 }),
	task('passport', { parentId: 'trip', order: 0 }),
	task('charger', { parentId: 'trip', order: 1 }),
	task('cable', { parentId: 'charger' }),
];

const ids = (tasks: readonly Task[]) => tasks.map(t => t.id);
const NOW = 1_000;

describe('subtask tree', () => {
	test('children come in sibling order and descendants reach every level', () => {
		expect(ids(groupChildren(trip()).get('trip')!)).toEqual(['passport', 'charger', 'socks']);
		expect(ids(descendantsOf(trip(), 'trip'))).toEqual(['passport', 'charger', 'socks', 'cable']);
		expect(ids(ancestorsOf(trip(), 'cable'))).toEqual(['trip', 'charger']);
		expect(nextSiblingOrder(trip(), 'trip')).toBe(3);
		expect(nextSiblingOrder(trip(), 'socks')).toBe(0);
	});

	test('progress counts done direct children and is null without any', () => {
		const tasks = trip().map(t => (t.id === 'passport' ? { ...t, completedAt: 5 } : t));
		expect(progressOf(groupChildren(tasks).get('trip')!)).toEqual({ done: 1, total: 3 });
		expect(progressOf([])).toBeNull();
	});
});

describe('completeTask', () => {
	test('completing a parent completes every open task under it and leaves done ones alone', () => {
		const tasks = trip().map(t => (t.id === 'passport' ? { ...t, completedAt: 5 } : t));
		const completion = completeTask(tasks, 'trip', '2026-10-14', NOW)!;
		expect(completion.kind).toBe('done');
		expect(completion.changed.map(t => [t.id, t.completedAt])).toEqual([
			['trip', NOW],
			['charger', NOW],
			['socks', NOW],
			['cable', NOW],
		]);
	});

	test('completing a recurring parent moves it to the next occurrence and reopens every task under it', () => {
		const tasks = [
			task('review', { due: { date: '2026-10-16', time: null }, recurrence: { interval: 1, unit: 'week' } }),
			task('inbox zero', { parentId: 'review', completedAt: 5 }),
			task('plan', { parentId: 'review' }),
			task('calendar', { parentId: 'plan', completedAt: 6 }),
		];
		const completion = completeTask(tasks, 'review', '2026-10-14', NOW)!;
		expect(completion).toEqual({
			kind: 'rolled',
			next: { date: '2026-10-23', time: null },
			changed: [
				{ ...tasks[0]!, due: { date: '2026-10-23', time: null } },
				{ ...tasks[1]!, completedAt: null },
				{ ...tasks[3]!, completedAt: null },
			],
		});
	});

	test('a parent repeating on a weekday set rolls to its next listed weekday and reopens its subtasks', () => {
		const tasks = [
			task('gym', {
				due: { date: '2026-10-16', time: null },
				recurrence: { interval: 1, unit: 'week', days: [1, 3, 5] },
			}),
			task('stretch', { parentId: 'gym', completedAt: 5 }),
		];
		const completion = completeTask(tasks, 'gym', '2026-10-16', NOW)!;
		expect(completion.kind).toBe('rolled');
		expect(completion.changed.map(t => [t.id, t.due?.date, t.completedAt])).toEqual([
			['gym', '2026-10-19', null],
			['stretch', undefined, null],
		]);
	});

	test('reopening a subtask reopens the completed tasks above it', () => {
		const tasks = trip().map(t => ({ ...t, completedAt: 5 }));
		expect(reopenTask(tasks, 'cable').map(t => [t.id, t.completedAt])).toEqual([
			['trip', null],
			['charger', null],
			['cable', null],
		]);
	});
});

describe('moveSubtask', () => {
	test('moving writes only the moved subtask, between its new neighbors', () => {
		expect(moveSubtask(trip(), 'socks', 0).map(t => [t.id, t.order])).toEqual([['socks', -1]]);
		expect(moveSubtask(trip(), 'passport', 1).map(t => [t.id, t.order])).toEqual([['passport', 1.5]]);
		expect(moveSubtask(trip(), 'passport', 99).map(t => [t.id, t.order])).toEqual([['passport', 3]]);
		expect(moveSubtask(trip(), 'charger', 1)).toEqual([]);
	});

	test('a tie from two concurrent moves settles by id', () => {
		const tied = trip().map(t => (t.id === 'socks' ? { ...t, order: 0 } : t));
		expect(ids(groupChildren(tied).get('trip')!)).toEqual(['passport', 'socks', 'charger']);
	});

	test('a gap too small to split renumbers the siblings', () => {
		const tight = trip().map(t => (t.id === 'charger' ? { ...t, order: 1e-10 } : t));
		expect(moveSubtask(tight, 'socks', 1).map(t => [t.id, t.order])).toEqual([
			['socks', 1],
			['charger', 2],
		]);
	});
});

describe('detachOrphans', () => {
	test('a task under a missing parent or in a parent loop becomes top level and the rest keep their parent', () => {
		const tasks = [
			task('a', { parentId: 'b' }),
			task('b', { parentId: 'a' }),
			task('lost', { parentId: 'gone' }),
			...trip(),
		];
		expect(detachOrphans(tasks).map(t => [t.id, t.parentId])).toEqual([
			['a', null],
			['b', null],
			['lost', null],
			['trip', null],
			['socks', 'trip'],
			['passport', 'trip'],
			['charger', 'trip'],
			['cable', 'charger'],
		]);
	});
});
