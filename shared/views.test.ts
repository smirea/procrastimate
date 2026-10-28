import { expect } from 'bun:test';
import type { Task } from './task.ts';
import * as views from './views.ts';
import { describe, recorded, test } from './vectors/record.ts';
import { task as base } from './testing.ts';

const inboxTasks = recorded('views', views.inboxTasks);
const labelTasks = recorded('views', views.labelTasks);
const noDateTasks = recorded('views', views.noDateTasks);
const projectTasks = recorded('views', views.projectTasks);
const projectGroups = recorded('views', views.projectGroups);
const todayTasks = recorded('views', views.todayTasks);
const upcomingGroups = recorded('views', views.upcomingGroups);
const dueDays = recorded('views', views.dueDays);
const weekEnd = recorded('views', views.weekEnd);
const placeTasks = recorded('views', views.placeTasks);
const labelViewTasks = recorded('views', views.labelViewTasks);
const eventTasks = recorded('views', views.eventTasks);
const completedRange = recorded('views', views.completedRange);
const completedTasks = recorded('views', views.completedTasks);
const completedDays = recorded('views', views.completedDays);
const projectCompleted = recorded('views', views.projectCompleted);
const pendingCount = recorded('views', views.pendingCount);
const sectionBadge = recorded('views', views.sectionBadge);
const openCounts = recorded('views', views.openCounts);

let created = 0;
const task = (id: string, fields: Partial<Task> = {}): Task => base(id, { createdAt: ++created, ...fields });

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

	test('a project groups its tasks under its sections, the tasks in no section first and empty sections kept', () => {
		const section = (id: string, order: number, projectId = 'p') => ({
			id,
			projectId,
			name: id,
			order,
			counter: 'quiet' as const,
			createdAt: 1,
		});
		const sections = [section('later', 2), section('next', 1), section('empty', 3), section('elsewhere', 0, 'q')];
		const list = [
			task('loose', { projectId: 'p' }),
			task('soon', { projectId: 'p', sectionId: 'next', priority: 2 }),
			task('first', { projectId: 'p', sectionId: 'next', priority: 1 }),
			task('child', { projectId: 'p', parentId: 'soon' }),
			task('done', { projectId: 'p', sectionId: 'later', completedAt: 5 }),
			task('stray', { projectId: 'p', sectionId: 'elsewhere' }),
			task('someday', { projectId: 'p', sectionId: 'later' }),
		];
		expect(projectGroups(list, sections, 'p').map(g => [g.section?.id ?? null, ids(g.tasks)])).toEqual([
			[null, ['loose', 'stray']],
			['next', ['first', 'soon']],
			['later', ['someday']],
			['empty', []],
		]);
	});

	test("a project's done tasks keep their section, newest first, and those whose section is gone come last", () => {
		const section = (id: string, order: number) => ({
			id,
			projectId: 'p',
			name: id,
			order,
			counter: 'quiet' as const,
			createdAt: 1,
		});
		const sections = [section('later', 2), section('next', 1)];
		const list = [
			task('open', { projectId: 'p', sectionId: 'next' }),
			task('shipped', { projectId: 'p', sectionId: 'next', completedAt: 10 }),
			task('filed', { projectId: 'p', sectionId: 'next', completedAt: 30 }),
			task('loose done', { projectId: 'p', completedAt: 20 }),
			task('step', { projectId: 'p', parentId: 'open', completedAt: 40 }),
			task('orphan', { projectId: 'p', sectionId: 'deleted', completedAt: 50 }),
			task('other project', { projectId: 'q', sectionId: 'next', completedAt: 60 }),
		];
		const { groups, gone } = projectCompleted(list, sections, 'p');
		expect(groups.map(g => [g.section?.id ?? null, ids(g.tasks)])).toEqual([
			[null, ['loose done']],
			['next', ['step', 'filed', 'shipped']],
			['later', []],
		]);
		expect(ids(gone)).toEqual(['orphan']);
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
		const park = { id: 'park', name: 'Park', color: 'green' as const, createdAt: 0 };
		const spot = { address: null, latitude: 52.52001, longitude: 13.405, radius: 500 };
		expect(ids(labelViewTasks(list, { ...park, place: spot }))).toEqual(['jan', 'kite']);
		expect(ids(labelViewTasks([...list, task('call', { labelIds: ['park'] })], { ...park, place: null }))).toEqual([
			'call',
		]);
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

	test('lists undated inbox tasks in one list, places included, oldest first', () => {
		const list = [
			task('read'),
			task('milk', { location: at('Rewe', 52.5) }),
			task('eggs', { location: at('Rewe', 52.5) }),
			task('dated at Rewe', { location: at('Rewe', 52.5), due: { date: today, time: null } }),
			task('beans', { priority: 1 }),
			task('chore', { projectId: 'home' }),
		];
		expect(ids(noDateTasks(list, today, false))).toEqual(['read', 'milk', 'eggs', 'beans']);
	});

	test('newest first flips the order', () => {
		const list = [
			task('old'),
			task('mid', { priority: 1 }),
			task('new'),
			task('later', { due: { date: today, time: null } }),
		];
		expect(ids(noDateTasks(list, today, true))).toEqual(['new', 'mid', 'old']);
	});
});

describe('due days', () => {
	const days = (due: views.DueDays) => [ids(due.overdue), ids(due.today), due.days.map(g => [g.date, ids(g.tasks)])];

	test('Inbox lists every dated task', () => {
		expect(days(dueDays(tasks, today, 'inbox'))).toEqual([
			['long overdue', 'overdue'],
			['today 9am urgent', 'today 9am', 'today 5pm', 'today, no time', 'subtask'],
			[
				['2026-10-15', ['tomorrow 8am', 'tomorrow']],
				['2026-10-16', ['inbox subtask']],
				['2026-11-02', ['after DST']],
			],
		]);
	});

	test('This week stops at Sunday, overdue included', () => {
		const list = [
			...tasks,
			task('sunday', { due: { date: '2026-10-18', time: null } }),
			task('monday', { due: { date: '2026-10-19', time: null } }),
		];
		expect(days(dueDays(list, today, 'this-week'))).toEqual([
			['long overdue', 'overdue'],
			['today 9am urgent', 'today 9am', 'today 5pm', 'today, no time', 'subtask'],
			[
				['2026-10-15', ['tomorrow 8am', 'tomorrow']],
				['2026-10-16', ['inbox subtask']],
				['2026-10-18', ['sunday']],
			],
		]);
	});

	test('This week on a Sunday is only today and what is overdue', () => {
		const list = [
			task('sunday', { due: { date: '2026-10-18', time: null } }),
			task('monday', { due: { date: '2026-10-19', time: null } }),
		];
		expect(days(dueDays(list, '2026-10-18', 'this-week'))).toEqual([[], ['sunday'], []]);
		expect(weekEnd('2026-10-18')).toBe('2026-10-18');
		expect(weekEnd('2026-10-19')).toBe('2026-10-25');
	});

	test('Tomorrow lists only tomorrow', () => {
		expect(days(dueDays(tasks, today, 'tomorrow'))).toEqual([[], [], [['2026-10-15', ['tomorrow 8am', 'tomorrow']]]]);
		expect(days(dueDays([], today, 'tomorrow'))).toEqual([[], [], []]);
	});
});

describe('completed', () => {
	const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
	const list = [
		task('paid rent', { completedAt: at(14, 9) }),
		task('old', { completedAt: at(1, 12) }),
		task('standup', {
			recurrence: { interval: 1, unit: 'day' },
			due: { date: '2026-10-15', time: null },
			lastCompletedAt: at(13, 10),
		}),
		task('reopened', { lastCompletedAt: at(14, 8) }),
		task('never done', { recurrence: { interval: 1, unit: 'day' } }),
		task('trip', { completedAt: at(12, 18), projectId: 'home' }),
		task('pack', { parentId: 'trip', projectId: 'home', completedAt: at(12, 18) }),
		task('book', { parentId: 'trip', projectId: 'home', completedAt: at(10, 7) }),
		task('call', { parentId: 'no such parent', completedAt: at(14, 11) }),
		task('tie', { completedAt: at(14, 9) }),
		task('chore', {}),
		task('sweep', { parentId: 'chore', recurrence: { interval: 1, unit: 'week' }, lastCompletedAt: at(11, 8) }),
	];

	test('presets count today in their days', () => {
		expect((['today', 'week', 'month', 'all'] as const).map(p => completedRange(p, today))).toEqual([
			{ from: today, to: today },
			{ from: '2026-10-08', to: today },
			{ from: '2026-09-15', to: today },
			{ from: null, to: null },
		]);
	});

	test('lists done tasks and the last roll of repeating ones, newest first', () => {
		expect(ids(completedTasks(list, { from: null, to: null }))).toEqual([
			'call',
			'paid rent',
			'tie',
			'standup',
			'trip',
			'sweep',
			'book',
			'old',
		]);
	});

	test('a range keeps only the days inside it, both ends included', () => {
		expect(ids(completedTasks(list, { from: '2026-10-12', to: '2026-10-13' }))).toEqual(['standup', 'trip']);
		expect(ids(completedTasks(list, completedRange('today', today)))).toEqual(['call', 'paid rent', 'tie']);
		expect(completedTasks([], { from: null, to: null })).toEqual([]);
	});

	test('groups by the local day of completion', () => {
		expect(completedDays(list, completedRange('week', today)).map(g => [g.date, ids(g.tasks)])).toEqual([
			['2026-10-14', ['call', 'paid rent', 'tie']],
			['2026-10-13', ['standup']],
			['2026-10-12', ['trip']],
			['2026-10-11', ['sweep']],
			['2026-10-10', ['book']],
		]);
	});
});

describe('open counts', () => {
	test('counts what each project and label view lists, in one pass', () => {
		const location = {
			name: 'Park',
			address: null,
			latitude: 52.52,
			longitude: 13.405,
			radius: 150,
			trigger: 'during' as const,
		};
		const list = [...tasks, task('kite', { location }), task('done kite', { location, completedAt: 5 })];
		const park = { id: 'park', name: 'Park', color: 'green' as const, createdAt: 0 };
		const calls = { id: 'calls', name: 'Calls', color: 'green' as const, createdAt: 0, place: null };
		const spot = { address: null, latitude: 52.52001, longitude: 13.405, radius: 500 };
		const labels = [{ ...park, place: spot }, calls];
		const counts = openCounts(list, labels);
		expect(counts.projects.get('home')).toBe(projectTasks(list, 'home').length);
		expect(counts.labels.get('park')).toBe(labelViewTasks(list, labels[0]!).length);
		expect(counts.labels.get('calls')).toBe(labelViewTasks(list, calls).length);
		expect([[...counts.projects], [...counts.labels]]).toEqual([
			[['home', 3]],
			[
				['park', 1],
				['calls', 4],
			],
		]);
	});
});

describe('pending count', () => {
	test('shows only above 4 open rows', () => {
		expect([0, 1, 4, 5, 12].map(n => pendingCount(n))).toEqual([null, null, null, 5, 12]);
	});
});

describe('section badge', () => {
	test("counts a section's overdue and today's rows when it has any, like the Inbox badge", () => {
		const rows = [
			task('late', { due: { date: '2026-10-12', time: null } }),
			task('now', { due: { date: today, time: '09:00' } }),
			task('later', { due: { date: '2026-10-20', time: null } }),
			task('undated'),
		];
		expect(sectionBadge(rows, today)).toEqual({ count: 2, due: true });
	});

	test('counts every open row in the accent when none is due', () => {
		const rows = [task('later', { due: { date: '2026-10-20', time: null } }), task('undated')];
		expect(sectionBadge(rows, today)).toEqual({ count: 2, due: false });
		expect(sectionBadge([task('only')], today)).toEqual({ count: 1, due: false });
	});

	test('shows nothing for an empty section', () => {
		expect(sectionBadge([], today)).toBeNull();
	});
});
