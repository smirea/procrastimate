import { expect } from 'bun:test';
import type { Task } from './task.ts';
import * as views from './views.ts';
import { describe, recorded, test } from './vectors/record.ts';

const inboxTasks = recorded('views', views.inboxTasks);
const labelTasks = recorded('views', views.labelTasks);
const noDateTasks = recorded('views', views.noDateTasks);
const projectTasks = recorded('views', views.projectTasks);
const todayTasks = recorded('views', views.todayTasks);
const upcomingGroups = recorded('views', views.upcomingGroups);
const placeTasks = recorded('views', views.placeTasks);
const eventTasks = recorded('views', views.eventTasks);

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
	location: null,
	event: null,
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
	test('Inbox lists open top-level tasks without a project or a day, by priority, then creation', () => {
		expect(ids(inboxTasks(tasks, today))).toEqual(['urgent, no date', 'no date']);
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
		expect(inboxTasks([], today)).toEqual([]);
		expect(todayTasks([], today)).toEqual({ overdue: [], today: [] });
		expect(upcomingGroups([], today)).toEqual([]);
	});

	test('event tasks sit on their occurrence and place tasks list by place', () => {
		const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
		const event = (edge: 'before' | 'after', start: number) => ({
			id: 'meetup',
			title: 'Walking meetup',
			allDay: false,
			series: false,
			edge,
			minutes: 30,
			occurrences: [{ start, end: start + 3_600_000, original: start }],
		});
		const location = {
			name: 'Park',
			address: null,
			latitude: 52.52,
			longitude: 13.405,
			radius: 150,
			trigger: 'during' as const,
		};
		const list = [
			task('notes', { event: event('after', at(14, 18)) }),
			task('jan', { event: event('before', at(14, 18)), location }),
			task('missed', { event: event('before', at(12, 18)) }),
			task('next week', { event: event('before', at(21, 18)) }),
			task('kite', { location }),
		];
		const { overdue, today: due } = todayTasks(list, today);
		expect(ids(overdue)).toEqual(['missed']);
		expect(ids(due)).toEqual(['jan', 'notes']);
		expect(upcomingGroups(list, today).map(g => [g.date, ids(g.tasks)])).toEqual([['2026-10-21', ['next week']]]);
		expect(ids(eventTasks(list, 'meetup', today))).toEqual(['missed', 'jan', 'notes', 'next week']);
		expect(ids(placeTasks(list, '52.5200,13.4050'))).toEqual(['jan', 'kite']);
	});
});

describe('no date', () => {
	const at = (name: string, latitude: number) => ({
		name,
		address: '',
		latitude,
		longitude: 13.4,
		radius: 150,
		trigger: 'arrive' as const,
	});

	test('places with two or more undated tasks get their own sections below the rest', () => {
		const list = [
			task('read'),
			task('milk', { location: at('Rewe', 52.5) }),
			task('coffee', { location: at('Philz', 52.6) }),
			task('eggs', { location: at('Supermarket', 52.50001) }),
			task('dated at Rewe', { location: at('Rewe', 52.5), due: { date: today, time: null } }),
			task('beans', { location: at('Philz', 52.6), priority: 1 }),
			task('solo', { location: at('Park', 52.7) }),
		];
		const view = noDateTasks(list, today);
		expect(ids(view.loose)).toEqual(['read', 'solo']);
		expect(view.places.map(p => [p.name, ids(p.tasks)])).toEqual([
			['Philz', ['beans', 'coffee']],
			['Rewe', ['milk', 'eggs']],
		]);
	});
});
