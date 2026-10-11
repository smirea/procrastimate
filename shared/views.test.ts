import { expect } from 'bun:test';
import type { Task } from './task.ts';
import * as views from './views.ts';
import { describe, recorded, test } from './vectors/record.ts';

const inboxTasks = recorded('views', views.inboxTasks);
const labelTasks = recorded('views', views.labelTasks);
const projectTasks = recorded('views', views.projectTasks);
const todayTasks = recorded('views', views.todayTasks);
const upcomingGroups = recorded('views', views.upcomingGroups);

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
	createdAt: ++created,
	completedAt: null,
	...fields,
});

// Wednesday, October 14 2026.
const today = '2026-10-14';

const tasks = [
	task('no date'),
	task('urgent, no date', { priority: 1 }),
	task('today 5pm', { due: { date: today, time: '17:00' }, labelIds: ['calls'] }),
	task('today, no time', { due: { date: today, time: null } }),
	task('today 9am', { due: { date: today, time: '09:00' }, priority: 3 }),
	task('today 9am urgent', { due: { date: today, time: '09:00' }, priority: 1 }),
	task('overdue', { due: { date: '2026-10-12', time: null }, labelIds: ['calls'] }),
	task('long overdue', { due: { date: '2026-09-30', time: '08:00' } }),
	task('done today', { due: { date: today, time: null }, completedAt: 5 }),
	task('tomorrow', { due: { date: '2026-10-15', time: null }, projectId: 'home' }),
	task('tomorrow 8am', { due: { date: '2026-10-15', time: '08:00' } }),
	task('after DST', { due: { date: '2026-11-02', time: '09:00' }, projectId: 'home', labelIds: ['calls'] }),
	task('home chore', { projectId: 'home' }),
	task('done chore', { projectId: 'home', completedAt: 5 }),
	task('subtask', { parentId: 'home chore', projectId: 'home', due: { date: today, time: null }, labelIds: ['calls'] }),
	task('inbox subtask', { parentId: 'no date', due: { date: '2026-10-16', time: null } }),
];

const ids = (list: readonly Task[]) => list.map(t => t.id);

describe('task views', () => {
	test('Inbox lists open top-level tasks without a project, by date, then priority, then creation', () => {
		expect(ids(inboxTasks(tasks))).toEqual([
			'long overdue',
			'overdue',
			'today 9am urgent',
			'today 9am',
			'today 5pm',
			'today, no time',
			'tomorrow 8am',
			'urgent, no date',
			'no date',
		]);
	});

	test('a project lists its open top-level tasks', () => {
		expect(ids(projectTasks(tasks, 'home'))).toEqual(['tomorrow', 'after DST', 'home chore']);
		expect(projectTasks(tasks, 'missing')).toEqual([]);
	});

	test('a label lists every open task with it, subtasks included', () => {
		expect(ids(labelTasks(tasks, 'calls'))).toEqual(['overdue', 'today 5pm', 'subtask', 'after DST']);
	});

	test('Today splits overdue from today and includes dated subtasks', () => {
		const { overdue, today: due } = todayTasks(tasks, today);
		expect(ids(overdue)).toEqual(['long overdue', 'overdue']);
		expect(ids(due)).toEqual(['today 9am urgent', 'today 9am', 'today 5pm', 'today, no time', 'subtask']);
	});

	test('Upcoming groups later tasks by day in date order', () => {
		expect(upcomingGroups(tasks, today).map(g => [g.date, ids(g.tasks)])).toEqual([
			['2026-10-15', ['tomorrow 8am', 'tomorrow']],
			['2026-10-16', ['inbox subtask']],
			['2026-11-02', ['after DST']],
		]);
	});

	test('empty lists stay empty', () => {
		expect(inboxTasks([])).toEqual([]);
		expect(todayTasks([], today)).toEqual({ overdue: [], today: [] });
		expect(upcomingGroups([], today)).toEqual([]);
	});
});
