import { expect } from 'bun:test';
import * as store from './store.ts';
import type { StoreData } from './store.ts';
import type { Task } from './task.ts';
import { describe, recorded, test } from './vectors/record.ts';

const addLabel = recorded('store', store.addLabel);
const addProject = recorded('store', store.addProject);
const addSection = recorded('store', store.addSection);
const addTask = recorded('store', store.addTask);
const completeTask = recorded('store', store.completeTask);
const deleteLabel = recorded('store', store.deleteLabel);
const deleteProject = recorded('store', store.deleteProject);
const deleteSection = recorded('store', store.deleteSection);
const deleteTask = recorded('store', store.deleteTask);
const explodeSubtasks = recorded('store', store.explodeSubtasks);
const moveSection = recorded('store', store.moveSection);
const moveSubtask = recorded('store', store.moveSubtask);
const renameLabel = recorded('store', store.renameLabel);
const renameProject = recorded('store', store.renameProject);
const renameSection = recorded('store', store.renameSection);
const reopenTask = recorded('store', store.reopenTask);
const restoreCompletion = recorded('store', store.restoreCompletion);
const restoreExploded = recorded('store', store.restoreExploded);
const sectionsOf = recorded('store', store.sectionsOf);
const sectionTasks = recorded('store', store.sectionTasks);
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
	sectionId: null,
	labelIds: [],
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	location: null,
	event: null,
	createdAt,
	completedAt: null,
	createdBy: null,
	completedBy: null,
	lastCompletedAt: null,
	...fields,
});

const NOW = 1_000;
const today = '2026-10-14';

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
	sections: [
		{ id: 'later', projectId: 'home', name: 'Later', order: 1, createdAt: 1 },
		{ id: 'next', projectId: 'home', name: 'Next', order: 0, createdAt: 2 },
		{ id: 'someday', projectId: 'work', name: 'Someday', order: 0, createdAt: 3 },
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
	location: null,
	event: null,
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
				{ id: 'trip', completedAt: null, lastCompletedAt: null, due: null, reminders: [], event: null },
				{ id: 'passport', completedAt: null, lastCompletedAt: null, due: null, reminders: [], event: null },
			],
		});
		expect(ids(next.tasks.filter(t => t.completedAt === NOW))).toEqual(['trip', 'passport']);
		expect(ids(next.tasks.filter(t => t.lastCompletedAt === NOW))).toEqual(['trip']);
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
					lastCompletedAt: null,
					due: { date: today, time: '09:00' },
					reminders: [{ kind: 'at', date: today, time: '08:00' }],
					event: null,
				},
			],
		});
		expect(find(next, 'standup').reminders).toEqual([{ kind: 'at', date: '2026-10-15', time: '08:00' }]);
		expect([find(next, 'standup').completedAt, find(next, 'standup').lastCompletedAt]).toEqual([null, NOW]);
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

describe('exploding subtasks', () => {
	const due = { date: today, time: '18:00' } as const;
	const outline = (): StoreData => ({
		tasks: [
			task('trip', 1, { projectId: 'home', labelIds: ['calls'], due, priority: 2 }),
			task('passport', 2, { parentId: 'trip', projectId: 'home', order: 1 }),
			task('charger', 3, {
				parentId: 'trip',
				projectId: 'home',
				labelIds: ['phone'],
				due: { date: '2026-10-20', time: null },
				priority: 1,
				completedAt: 50,
			}),
			task('photo', 4, { parentId: 'passport', projectId: 'home' }),
		],
		projects: [],
		sections: [],
		labels: [],
	});
	const shape = (next: StoreData) =>
		next.tasks.map(({ id, parentId, order, title, labelIds, due, priority }) => ({
			id,
			parentId,
			order,
			title,
			labelIds,
			due,
			priority,
		}));

	test('directly makes each subtask a top-level task with its own title, keeping its subtasks', () => {
		const { data: next, previous } = explodeSubtasks(outline(), 'trip', 'direct');
		expect(shape(next)).toEqual([
			{ id: 'trip', parentId: null, order: 0, title: 'trip', labelIds: ['calls'], due, priority: 2 },
			{ id: 'passport', parentId: null, order: 0, title: 'passport', labelIds: [], due: null, priority: 4 },
			{
				id: 'charger',
				parentId: null,
				order: 0,
				title: 'charger',
				labelIds: ['phone'],
				due: { date: '2026-10-20', time: null },
				priority: 1,
			},
			{ id: 'photo', parentId: 'passport', order: 0, title: 'photo', labelIds: [], due: null, priority: 4 },
		]);
		expect(find(next, 'charger').completedAt).toBe(50);
		expect(find(next, 'passport').projectId).toBe('home');
		expect(restoreExploded(next, previous)).toEqual(outline());
	});

	test("a sectioned parent's subtasks land in its section, and undo takes them back out", () => {
		const before = {
			...outline(),
			sections: [{ id: 'later', projectId: 'home', name: 'Later', order: 0, createdAt: 1 }],
		};
		before.tasks = before.tasks.map(t => (t.id === 'trip' ? { ...t, sectionId: 'later' } : t));
		const { data: next, previous } = explodeSubtasks(before, 'trip', 'direct');
		expect(next.tasks.map(t => [t.id, t.sectionId])).toEqual([
			['trip', 'later'],
			['passport', 'later'],
			['charger', 'later'],
			['photo', null],
		]);
		expect(restoreExploded(next, previous)).toEqual(before);
	});

	test("prefix puts the parent's title before each subtask's", () => {
		const { data: next } = explodeSubtasks(outline(), 'trip', 'prefix');
		expect(next.tasks.map(t => t.title)).toEqual(['trip', 'trip: passport', 'trip: charger', 'photo']);
	});

	test("inherit fills in the parent's labels, date, and priority only where a subtask has none", () => {
		const { data: next } = explodeSubtasks(outline(), 'trip', 'inherit');
		expect(shape(next).slice(1, 3)).toEqual([
			{ id: 'passport', parentId: null, order: 0, title: 'passport', labelIds: ['calls'], due, priority: 2 },
			{
				id: 'charger',
				parentId: null,
				order: 0,
				title: 'charger',
				labelIds: ['phone'],
				due: { date: '2026-10-20', time: null },
				priority: 1,
			},
		]);
	});

	test('a nested parent passes its subtasks up to sit right after it, in order', () => {
		const { data: next, previous } = explodeSubtasks(
			{ ...outline(), tasks: [...outline().tasks, task('visa', 5, { parentId: 'trip', projectId: 'home', order: 2 })] },
			'passport',
			'prefix',
		);
		expect(shape(next).filter(t => t.parentId === 'trip')).toEqual([
			{ id: 'passport', parentId: 'trip', order: 1, title: 'passport', labelIds: [], due: null, priority: 4 },
			{
				id: 'charger',
				parentId: 'trip',
				order: 0,
				title: 'charger',
				labelIds: ['phone'],
				due: { date: '2026-10-20', time: null },
				priority: 1,
			},
			{ id: 'photo', parentId: 'trip', order: 1.5, title: 'passport: photo', labelIds: [], due: null, priority: 4 },
			{ id: 'visa', parentId: 'trip', order: 2, title: 'visa', labelIds: [], due: null, priority: 4 },
		]);
		expect(previous).toEqual([
			{
				id: 'photo',
				parentId: 'passport',
				order: 0,
				sectionId: null,
				title: 'photo',
				labelIds: [],
				due: null,
				priority: 4,
			},
		]);
	});

	test('undo leaves a subtask where it is when its parent was deleted since', () => {
		const { data: next, previous } = explodeSubtasks(outline(), 'trip', 'prefix');
		const { data: deleted } = deleteTask(next, 'trip');
		expect(shape(restoreExploded(deleted, previous))).toEqual([
			{ id: 'passport', parentId: null, order: 0, title: 'passport', labelIds: [], due: null, priority: 4 },
			{
				id: 'charger',
				parentId: null,
				order: 0,
				title: 'charger',
				labelIds: ['phone'],
				due: { date: '2026-10-20', time: null },
				priority: 1,
			},
			{ id: 'photo', parentId: 'passport', order: 0, title: 'photo', labelIds: [], due: null, priority: 4 },
		]);
	});

	test('a task without subtasks, or a missing one, changes nothing', () => {
		expect(explodeSubtasks(outline(), 'photo', 'direct')).toEqual({ data: outline(), previous: [] });
		expect(explodeSubtasks(outline(), 'missing', 'direct')).toEqual({ data: outline(), previous: [] });
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
		expect(deleted.sections.map(s => s.id)).toEqual(['someday']);
	});
});

describe('sections', () => {
	const sectioned = (): StoreData => updateTask(data(), 'trip', { sectionId: 'next' });

	test('a project lists its sections in their order', () => {
		expect(sectionsOf(data().sections, 'home').map(s => s.id)).toEqual(['next', 'later']);
	});

	test('a new section comes last in its project, and a taken name returns the section that has it', () => {
		const { data: added, section } = addSection(data(), 'home', 'Errands', { id: 'errands', now: NOW });
		expect(section).toEqual({ id: 'errands', projectId: 'home', name: 'Errands', order: 2, createdAt: NOW });
		expect(sectionsOf(added.sections, 'home').map(s => s.id)).toEqual(['next', 'later', 'errands']);
		const taken = addSection(data(), 'home', 'later', { id: 'dup', now: NOW });
		expect([taken.section.id, taken.data]).toEqual(['later', data()]);
		expect(addSection(data(), 'work', 'Later', { id: 'w', now: NOW }).section.order).toBe(1);
	});

	test('renaming keeps names unique within a project, ignoring case', () => {
		expect(renameSection(data(), 'later', 'Soon').sections[0]!.name).toBe('Soon');
		expect(renameSection(data(), 'later', 'NEXT')).toEqual(data());
		expect(renameSection(data(), 'someday', 'Next').sections[2]!.name).toBe('Next');
	});

	test('moving a section writes only its own order', () => {
		const moved = moveSection(data(), 'later', 0);
		expect(sectionsOf(moved.sections, 'home').map(s => [s.id, s.order])).toEqual([
			['later', -1],
			['next', 0],
		]);
		expect(moveSection(data(), 'next', 0)).toEqual(data());
	});

	test('deleting a section deletes its tasks with their subtasks and leaves the rest of the project', () => {
		expect(ids(sectionTasks(sectioned().tasks, 'next'))).toEqual(['trip', 'passport', 'charger']);
		const deleted = deleteSection(sectioned(), 'next');
		expect(deleted.sections.map(s => s.id)).toEqual(['later', 'someday']);
		expect(ids(deleted.tasks)).toEqual(['standup', 'call']);
		expect(ids(deleteSection(data(), 'next').tasks)).toEqual(ids(data().tasks));
	});

	test('a section moves a task into its project, and its subtasks follow the project but sit in no section', () => {
		const next = updateTask(data(), 'call', { sectionId: 'someday' });
		expect([find(next, 'call').projectId, find(next, 'call').sectionId]).toEqual(['work', 'someday']);
		const trip = updateTask(data(), 'trip', { sectionId: 'someday' });
		expect(trip.tasks.filter(t => t.projectId === 'work').map(t => [t.id, t.sectionId])).toEqual([
			['trip', 'someday'],
			['passport', null],
			['charger', null],
		]);
	});

	test('a new project leaves the section, and no section keeps the project', () => {
		expect(find(updateTask(sectioned(), 'trip', { projectId: 'work' }), 'trip')).toMatchObject({
			projectId: 'work',
			sectionId: null,
		});
		expect(find(updateTask(sectioned(), 'trip', { sectionId: null }), 'trip')).toMatchObject({
			projectId: 'home',
			sectionId: null,
		});
		expect(find(updateTask(sectioned(), 'trip', { title: 'Rome' }), 'trip').sectionId).toBe('next');
	});

	test('a subtask never takes a section of its own', () => {
		expect(find(updateTask(data(), 'passport', { sectionId: 'someday' }), 'passport')).toMatchObject({
			projectId: 'home',
			sectionId: null,
		});
	});

	test('a new task goes into its section and that section’s project, and a subtask gets none', () => {
		const add = (input: { projectId?: string | null; sectionId: string }, parentId: string | null = null) => {
			const { task } = addTask(data(), { ...newTask, ...input }, parentId, { id: 'new', now: NOW });
			return [task.projectId, task.sectionId];
		};
		expect([
			add({ sectionId: 'someday' }),
			add({ projectId: null, sectionId: 'next' }),
			add({ sectionId: 'missing' }),
			add({ projectId: 'home', sectionId: 'next' }, 'trip'),
		]).toEqual([
			['work', 'someday'],
			['home', 'next'],
			['work', null],
			['home', null],
		]);
	});

	test('moving a sectioned task to Inbox clears its project and section', () => {
		expect(find(updateTask(sectioned(), 'trip', { projectId: null, sectionId: null }), 'trip')).toMatchObject({
			projectId: null,
			sectionId: null,
		});
		expect(find(updateTask(sectioned(), 'trip', { projectId: null }), 'trip')).toMatchObject({
			projectId: null,
			sectionId: null,
		});
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

	test('completing a task on an event series moves it past missed occurrences, and undo moves it back', () => {
		const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
		const occurrences = [7, 14, 21].map(d => ({ start: at(d, 18), end: at(d, 19), original: at(d, 18) }));
		const event = {
			id: 'meetup',
			title: 'Walking meetup',
			allDay: false,
			series: true,
			edge: 'during' as const,
			minutes: 0,
			occurrences,
		};
		const before: StoreData = { tasks: [task('jan', 1, { event })], projects: [], sections: [], labels: [] };
		const { data: next, completion } = completeTask(before, 'jan', today, NOW)!;
		expect(completion).toEqual({
			kind: 'rolled',
			next: { date: '2026-10-21', time: '18:00' },
			previous: [{ id: 'jan', completedAt: null, lastCompletedAt: null, due: null, reminders: [], event }],
		});
		expect(next.tasks[0]!.event!.occurrences).toEqual([occurrences[2]!]);
		expect(next.tasks[0]!.completedAt).toBeNull();
		expect(restoreCompletion(next, completion.previous)).toEqual(before);
		const last = completeTask(next, 'jan', '2026-10-21', NOW)!;
		expect(last.completion.kind).toBe('done');
	});
});
