import { expect } from 'bun:test';
import * as store from './store.ts';
import type { StoreData } from './store.ts';
import type { Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const addLabel = recorded('store', store.addLabel);
const addProject = recorded('store', store.addProject);
const addTask = recorded('store', store.addTask);
const completeTask = recorded('store', store.completeTask);
const deleteLabel = recorded('store', store.deleteLabel);
const deleteProject = recorded('store', store.deleteProject);
const deleteTask = recorded('store', store.deleteTask);
const moveSubtask = recorded('store', store.moveSubtask);
const renameLabel = recorded('store', store.renameLabel);
const renameProject = recorded('store', store.renameProject);
const reopenTask = recorded('store', store.reopenTask);
const restoreCompletion = recorded('store', store.restoreCompletion);
const sortTasks = recorded('store', store.sortTasks);
const undeleteTasks = recorded('store', store.undeleteTasks);
const updateTask = recorded('store', store.updateTask);

const task = (id: string, createdAt: number, fields: Partial<Task> = {}): Task => ({
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
	createdAt,
	completedAt: null,
	...fields,
});

const NOW = 1_000;
const today = '2026-10-14';

/** Trip, in Home, has Passport and Charger. Standup repeats daily. Call has the `calls` label. */
const data = (): StoreData => ({
	tasks: [
		task('trip', 1, { projectId: 'home' }),
		task('passport', 2, { parentId: 'trip', projectId: 'home' }),
		task('charger', 3, { parentId: 'trip', projectId: 'home', order: 1, completedAt: 50 }),
		task('standup', 4, {
			due: { date: today, time: '09:00' },
			recurrence: { interval: 1, unit: 'day' },
			reminders: [{ kind: 'at', date: today, time: '08:00' }],
		}),
		task('call', 5, { labelIds: ['calls', 'phone'] }),
	],
	projects: [
		{ id: 'home', name: 'Home', createdAt: 1 },
		{ id: 'work', name: 'Work', createdAt: 2 },
	],
	labels: [
		{ id: 'calls', name: 'calls', createdAt: 1 },
		{ id: 'phone', name: 'Phone', createdAt: 2 },
	],
});

const newTask = {
	title: 'New',
	projectId: 'work',
	labelIds: [],
	due: null,
	recurrence: null,
	priority: null,
	reminders: [],
};
const ids = (list: readonly Task[]) => list.map(t => t.id);
const find = (d: StoreData, id: string) => d.tasks.find(t => t.id === id)!;

describe('tasks', () => {
	test('a new task lands at the end with the default priority and its project', () => {
		const { data: next, task: added } = addTask(data(), newTask, null, { id: 'new', now: NOW });
		expect(added).toEqual(task('new', NOW, { title: 'New', projectId: 'work' }));
		expect(ids(next.tasks)).toEqual(['trip', 'passport', 'charger', 'standup', 'call', 'new']);
	});

	test('a subtask takes its parent project, comes last among siblings, and reopens a done parent', () => {
		const done = { ...data(), tasks: data().tasks.map(t => (t.id === 'trip' ? { ...t, completedAt: 60 } : t)) };
		const { data: next, task: added } = addTask(done, { ...newTask, priority: 2 }, 'trip', { id: 'socks', now: NOW });
		expect([added.parentId, added.projectId, added.order, added.priority]).toEqual(['trip', 'home', 2, 2]);
		expect(find(next, 'trip').completedAt).toBeNull();
	});

	test('a new task is created after the newest one, so tasks added under one clock reading keep their order', () => {
		const first = addTask(data(), newTask, null, { id: 'b-first', now: 3 });
		const second = addTask(first.data, newTask, null, { id: 'a-second', now: 3 });
		expect([first.task.createdAt, second.task.createdAt]).toEqual([6, 7]);
		expect(ids(second.data.tasks)).toEqual(['trip', 'passport', 'charger', 'standup', 'call', 'b-first', 'a-second']);
		expect(addTask({ ...data(), tasks: [] }, newTask, null, { id: 'new', now: NOW }).task.createdAt).toBe(NOW);
	});

	test('tasks sort by creation time, then id', () => {
		expect(ids(sortTasks([task('b', 2), task('c', 1), task('a', 2)]))).toEqual(['c', 'a', 'b']);
	});

	test('editing writes the patch, and a new project moves every subtask too', () => {
		const next = updateTask(data(), 'trip', { title: 'Trip to Rome', projectId: 'work' });
		expect(find(next, 'trip').title).toBe('Trip to Rome');
		expect(next.tasks.filter(t => t.projectId === 'work').map(t => t.id)).toEqual(['trip', 'passport', 'charger']);
		expect(updateTask(data(), 'missing', { title: 'x' })).toEqual(data());
	});

	test('completing a task and its subtasks keeps what undo needs', () => {
		const { data: next, completion } = completeTask(data(), 'trip', today, NOW)!;
		expect(completion).toEqual({
			kind: 'done',
			previous: [
				{ id: 'trip', completedAt: null, due: null, reminders: [] },
				{ id: 'passport', completedAt: null, due: null, reminders: [] },
			],
		});
		expect(ids(next.tasks.filter(t => t.completedAt === NOW))).toEqual(['trip', 'passport']);
		expect(restoreCompletion(next, completion.previous)).toEqual(data());
	});

	test('completing a repeating task moves it to its next occurrence and undo moves it back', () => {
		const { data: next, completion } = completeTask(data(), 'standup', today, NOW)!;
		expect(completion).toEqual({
			kind: 'rolled',
			next: { date: '2026-10-15', time: '09:00' },
			previous: [
				{
					id: 'standup',
					completedAt: null,
					due: { date: today, time: '09:00' },
					reminders: [{ kind: 'at', date: today, time: '08:00' }],
				},
			],
		});
		expect(find(next, 'standup').reminders).toEqual([{ kind: 'at', date: '2026-10-15', time: '08:00' }]);
		expect(restoreCompletion(next, completion.previous)).toEqual(data());
		expect(completeTask(data(), 'missing', today, NOW)).toBeNull();
	});

	test('undo keeps edits made since the completion', () => {
		const { data: done, completion } = completeTask(data(), 'trip', today, NOW)!;
		const edited = updateTask(done, 'trip', { title: 'Renamed' });
		expect(find(restoreCompletion(edited, completion.previous), 'trip')).toEqual(
			task('trip', 1, { projectId: 'home', title: 'Renamed' }),
		);
	});

	test('reopening a subtask reopens its parent', () => {
		const { data: done } = completeTask(data(), 'trip', today, NOW)!;
		const next = reopenTask(done, 'passport');
		expect(ids(next.tasks.filter(t => t.completedAt === null))).toEqual(['trip', 'passport', 'standup', 'call']);
	});

	test('moving a subtask writes only its own order', () => {
		const next = moveSubtask(data(), 'charger', 0);
		expect([find(next, 'charger').order, find(next, 'passport').order]).toEqual([-1, 0]);
	});

	test('deleting a task removes its subtasks, and undo puts them back in order', () => {
		const { data: next, removed } = deleteTask(data(), 'trip');
		expect(ids(removed)).toEqual(['trip', 'passport', 'charger']);
		expect(ids(next.tasks)).toEqual(['standup', 'call']);
		expect(undeleteTasks(next, removed)).toEqual(data());
		expect(undeleteTasks(data(), removed)).toEqual(data());
		expect(deleteTask(data(), 'missing')).toEqual({ data: data(), removed: [] });
	});
});

describe('projects', () => {
	test('adding, renaming, and deleting a project, which deletes its tasks', () => {
		const { data: added, project } = addProject(data(), 'Errands', { id: 'errands', now: NOW });
		expect(project).toEqual({ id: 'errands', name: 'Errands', createdAt: NOW });
		expect(added.projects.map(p => p.name)).toEqual(['Home', 'Work', 'Errands']);
		expect(renameProject(data(), 'home', 'House').projects[0]!.name).toBe('House');
		const deleted = deleteProject(data(), 'home');
		expect(deleted.projects.map(p => p.id)).toEqual(['work']);
		expect(ids(deleted.tasks)).toEqual(['standup', 'call']);
	});
});

describe('labels', () => {
	test('adding a label and renaming it, unique ignoring case', () => {
		const { data: added, label } = addLabel(data(), 'errands', { id: 'errands', now: NOW });
		expect(label).toEqual({ id: 'errands', name: 'errands', createdAt: NOW });
		expect(added.labels.map(l => l.name)).toEqual(['calls', 'Phone', 'errands']);
		expect(renameLabel(data(), 'calls', 'Calls').labels[0]!.name).toBe('Calls');
		expect(renameLabel(data(), 'calls', 'phone')).toEqual(data());
	});

	test('deleting a label takes it off its tasks and keeps them', () => {
		const next = deleteLabel(data(), 'calls');
		expect(next.labels.map(l => l.id)).toEqual(['phone']);
		expect(find(next, 'call').labelIds).toEqual(['phone']);
		expect(next.tasks.length).toBe(5);
	});
});
