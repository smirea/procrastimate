import { expect } from 'bun:test';
import * as subtasks from './subtasks.ts';
import type { Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';
import { task as base } from './testing.ts';

const ancestorsOf = recorded('subtasks', subtasks.ancestorsOf);
const completeTask = recorded('subtasks', subtasks.completeTask);
const descendantsOf = recorded('subtasks', subtasks.descendantsOf);
const detachOrphans = recorded('subtasks', subtasks.detachOrphans);
const groupChildren = recorded('subtasks', subtasks.groupChildren);
const moveSubtask = recorded('subtasks', subtasks.moveSubtask);
const nextSiblingOrder = recorded('subtasks', subtasks.nextSiblingOrder);
const progressOf = recorded('subtasks', subtasks.progressOf);
const reopenTask = recorded('subtasks', subtasks.reopenTask);

const task = (id: string, fields: Partial<Task> = {}): Task => base(id, fields);

const trip = () => [
	task('trip'),
	task('socks', { parentId: 'trip', order: 2 }),
	task('passport', { parentId: 'trip', order: 0 }),
	task('charger', { parentId: 'trip', order: 1 }),
	task('cable', { parentId: 'charger' }),
];

const ids = (tasks: readonly Task[]) => tasks.map(t => t.id);
const NOW = 1_000;

describe('completing on an event series in a zone', () => {
	test('the server passes the account’s zone, so the occurrence’s day is the account’s, not the process’s', () => {
		const berlin = (d: number, h: number) => Date.UTC(2026, 9, d, h - 2);
		const occurrences = [19, 20, 21].map(d => ({ start: berlin(d, 1), end: berlin(d, 2), original: berlin(d, 1) }));
		const event = { id: 'early', title: 'Early call', allDay: false, series: true, edge: 'start' as const, minutes: 0 };
		const tasks = [task('call', { event: { ...event, occurrences } })];
		const inZone = completeTask(tasks, 'call', '2026-10-19', NOW, 'Europe/Berlin')!;
		expect(inZone.kind === 'rolled' && inZone.next).toEqual({ date: '2026-10-20', time: '01:00' });
		expect(inZone.changed[0]!.event!.occurrences).toEqual(occurrences.slice(1));
	});
});

describe('an event task with a repeat', () => {
	test('completing follows the event, as the lists show it, not the repeat', () => {
		const occurrences = [19, 20].map(d => ({
			start: Date.UTC(2026, 9, d, 9),
			end: Date.UTC(2026, 9, d, 10),
			original: Date.UTC(2026, 9, d, 9),
		}));
		const event = { id: 'standup', title: 'Standup', allDay: false, series: true, edge: 'start' as const, minutes: 0 };
		const tasks = [
			task('notes', {
				due: { date: '2026-10-14', time: null },
				recurrence: { interval: 1, unit: 'day' },
				event: { ...event, occurrences },
			}),
		];
		const completion = completeTask(tasks, 'notes', '2026-10-19', NOW, 'UTC')!;
		expect(completion.kind === 'rolled' && completion.next).toEqual({ date: '2026-10-20', time: '09:00' });
		expect(completion.changed[0]!.event!.occurrences).toEqual(occurrences.slice(1));
		expect(completion.changed[0]!.due).toEqual({ date: '2026-10-14', time: null });
	});
});

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
		expect(progressOf(groupChildren(tasks).get('trip')!, false)).toEqual({ done: 1, total: 3 });
		expect(progressOf([], false)).toBeNull();
	});

	test('a completed parent counts every subtask as done, even one left open', () => {
		expect(progressOf(groupChildren(trip()).get('trip')!, true)).toEqual({ done: 3, total: 3 });
		expect(progressOf([], true)).toBeNull();
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
				{ ...tasks[0]!, due: { date: '2026-10-23', time: null }, lastCompletedAt: NOW },
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
