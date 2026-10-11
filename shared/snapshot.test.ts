import { expect } from 'bun:test';
import * as snapshot from './snapshot.ts';
import { describe, recorded, test } from './vectors/record.ts';

const parseSnapshot = recorded('snapshot', snapshot.parseSnapshot);

let created = 0;
const task = (id: string, recurrence: unknown, fields: Record<string, unknown> = {}) => ({
	id,
	title: id,
	notes: '',
	projectId: null,
	due: { date: '2026-10-14', time: null },
	recurrence,
	priority: 4,
	reminders: [],
	createdAt: ++created,
	completedAt: null,
	...fields,
});

/** A document as the web app writes it, with every field in use. */
const webDocument: snapshot.Snapshot = {
	tasks: [
		{
			id: 'a0d6b1e2-0001-4c1e-9b1e-000000000001',
			parentId: null,
			order: 0,
			title: 'Gym',
			notes: 'Leg day',
			projectId: 'p-home',
			labelIds: ['l-health'],
			due: { date: '2026-10-16', time: '07:00' },
			recurrence: { interval: 1, unit: 'week', days: [1, 3, 5] },
			priority: 2,
			reminders: [
				{ kind: 'before', minutes: 30 },
				{ kind: 'at', date: '2026-10-15', time: '21:00' },
			],
			createdAt: 1_791_900_000_000,
			completedAt: null,
		},
		{
			id: 'a0d6b1e2-0002-4c1e-9b1e-000000000002',
			parentId: 'a0d6b1e2-0001-4c1e-9b1e-000000000001',
			order: 1.5,
			title: 'Stretch',
			notes: '',
			projectId: 'p-home',
			labelIds: [],
			due: null,
			recurrence: null,
			priority: 4,
			reminders: [],
			createdAt: 1_791_900_000_001,
			completedAt: 1_791_950_000_000,
		},
		{
			id: 'a0d6b1e2-0003-4c1e-9b1e-000000000003',
			parentId: null,
			order: 0,
			title: 'Taxes',
			notes: '',
			projectId: null,
			labelIds: [],
			due: { date: '2026-11-01', time: null },
			recurrence: { interval: 1, unit: 'year' },
			priority: 1,
			reminders: [],
			createdAt: 1_791_900_000_002,
			completedAt: null,
			sourceKey: 'todoist:task:42',
		},
	],
	projects: [
		{ id: 'p-home', name: 'Home', createdAt: 1_791_800_000_000 },
		{ id: 'p-work', name: 'Work', createdAt: 1_791_800_000_001, sourceKey: 'todoist:project:7' },
	],
	labels: [{ id: 'l-health', name: 'health', createdAt: 1_791_800_000_002 }],
	remindersCheckedAt: 1_791_972_000_000,
	sync: {
		deviceId: 'd-phone',
		cursor: 12,
		outbox: [
			{
				opId: 'op-1',
				hlc: '1791972000000:0:d-phone',
				kind: 'task',
				id: 'a0d6b1e2-0001-4c1e-9b1e-000000000001',
				fields: { title: 'Gym', due: { date: '2026-10-16', time: '07:00' }, labelIds: ['l-health'] },
			},
			{ opId: 'op-2', hlc: '1791972000001:0:d-phone', kind: 'label', id: 'l-old', fields: { deleted: true } },
		],
	},
};

describe('parseSnapshot', () => {
	test('a document the web wrote reads back unchanged', () => {
		expect(parseSnapshot(webDocument, 10)).toEqual(webDocument);
	});

	test('a document without a sync section is an unpaired device', () => {
		const { sync: _, ...unpaired } = webDocument;
		expect(parseSnapshot(unpaired, 10)).toEqual(unpaired);
	});

	test('tasks come back sorted by when they were created, then by id', () => {
		const tasks = [
			task('c', null, { createdAt: 5 }),
			task('b', null, { createdAt: 5 }),
			task('a', null, { createdAt: 9 }),
		];
		expect(parseSnapshot({ tasks, projects: [], remindersCheckedAt: 5 }, 10).tasks.map(t => t.id)).toEqual([
			'b',
			'c',
			'a',
		]);
	});

	test('a task with an empty repeat interval is dropped and every other task is kept', () => {
		const loaded = parseSnapshot(
			{
				tasks: [task('Good', { interval: 2, unit: 'day' }), task('Bad', { interval: null, unit: 'day' })],
				projects: [{ id: 'p', name: 'Home', createdAt: 1 }],
				remindersCheckedAt: 5,
			},
			10,
		);
		expect(loaded.tasks.map(t => t.title)).toEqual(['Good']);
		expect(loaded.projects.map(p => p.name)).toEqual(['Home']);
		expect(loaded.remindersCheckedAt).toBe(5);
	});

	test.each([
		['a missing title', { title: undefined }],
		['a numeric title', { title: 7 }],
		['a missing due field', { due: undefined }],
		['a malformed date', { due: { date: '2026-1-4', time: null } }],
		['a malformed time', { due: { date: '2026-10-14', time: '7:00' } }],
		['priority 5', { priority: 5 }],
		['a fractional reminder offset', { reminders: [{ kind: 'before', minutes: 1.5 }] }],
		['a negative reminder offset', { reminders: [{ kind: 'before', minutes: -5 }] }],
		['an unknown reminder kind', { reminders: [{ kind: 'after', minutes: 5 }] }],
		['an unknown repeat unit', { recurrence: { interval: 1, unit: 'hour' } }],
		['a fractional repeat interval', { recurrence: { interval: 1.5, unit: 'day' } }],
		['a weekday out of range', { recurrence: { interval: 1, unit: 'week', days: [1, 7] } }],
		['a missing completion field', { completedAt: undefined }],
		['a string createdAt', { createdAt: 'yesterday' }],
	] as const)('a task with %s is dropped', (_, fields) => {
		const loaded = parseSnapshot(
			{ tasks: [task('Kept', null), task('Bad', null, fields)], projects: [], remindersCheckedAt: 5 },
			10,
		);
		expect(loaded.tasks.map(t => t.id)).toEqual(['Kept']);
	});

	test.each([
		['missing tasks', { projects: [], remindersCheckedAt: 5 }],
		['an invalid project', { tasks: [], projects: [{ id: 'p', name: 3, createdAt: 1 }], remindersCheckedAt: 5 }],
		['an invalid label', { tasks: [], projects: [], labels: [{ id: 'l' }], remindersCheckedAt: 5 }],
		['no reminder check time', { tasks: [], projects: [] }],
		[
			'an invalid sync section',
			{ tasks: [], projects: [], remindersCheckedAt: 5, sync: { deviceId: 'd', cursor: -1, outbox: [] } },
		],
		['not an object', ['tasks']],
		['null', null],
	] as const)('a document with %s starts empty', (_, document) => {
		expect(parseSnapshot(document, 10)).toEqual({ tasks: [], projects: [], labels: [], remindersCheckedAt: 10 });
	});

	test('a store saved before labels existed loads every task with no labels', () => {
		const loaded = parseSnapshot({ tasks: [task('Old', null)], projects: [], remindersCheckedAt: 5 }, 10);
		expect(loaded.tasks.map(t => [t.title, t.labelIds])).toEqual([['Old', []]]);
		expect(loaded.labels).toEqual([]);
	});

	test('labels and the labels on each task round-trip', () => {
		const loaded = parseSnapshot(
			{
				tasks: [{ ...task('Call', null), labelIds: ['l'] }],
				projects: [],
				labels: [{ id: 'l', name: 'calls', createdAt: 1 }],
				remindersCheckedAt: 5,
			},
			10,
		);
		expect(loaded.tasks[0]!.labelIds).toEqual(['l']);
		expect(loaded.labels).toEqual([{ id: 'l', name: 'calls', createdAt: 1 }]);
	});

	test('a weekday set survives a reload, a one-day set loads as a plain weekly repeat, and stored repeats without one still load', () => {
		const loaded = parseSnapshot(
			{
				tasks: [
					task('Gym', { interval: 1, unit: 'week', days: [5, 1, 3] }),
					task('Review', { interval: 1, unit: 'week' }),
					task('One day', { interval: 2, unit: 'week', days: [5, 5] }),
					task('Water', { interval: 2, unit: 'day' }),
					task('Old', undefined),
					task('Empty set', { interval: 1, unit: 'week', days: [] }),
					task('Days on a daily repeat', { interval: 1, unit: 'day', days: [1] }),
				],
				projects: [],
				remindersCheckedAt: 5,
			},
			10,
		);
		expect(loaded.tasks.map(t => [t.title, t.recurrence])).toEqual([
			['Gym', { interval: 1, unit: 'week', days: [1, 3, 5] }],
			['Review', { interval: 1, unit: 'week' }],
			['One day', { interval: 2, unit: 'week' }],
			['Water', { interval: 2, unit: 'day' }],
			['Old', null],
			['Days on a daily repeat', { interval: 1, unit: 'day' }],
		]);
	});

	test('a task stored before subtasks existed loads as a top-level task', () => {
		const loaded = parseSnapshot({ tasks: [task('Old', null)], projects: [], remindersCheckedAt: 5 }, 10);
		expect(loaded.tasks.map(t => [t.title, t.parentId, t.order])).toEqual([['Old', null, 0]]);
	});

	test('a subtask whose parent did not load becomes a top-level task', () => {
		const loaded = parseSnapshot(
			{
				tasks: [
					task('Parent', null, { parentId: null }),
					task('Kept', null, { parentId: 'Parent', order: 1 }),
					task('Orphan', null, { parentId: 'Bad' }),
					task('Bad', { interval: null, unit: 'day' }),
				],
				projects: [],
				remindersCheckedAt: 5,
			},
			10,
		);
		expect(loaded.tasks.map(t => [t.title, t.parentId, t.order])).toEqual([
			['Parent', null, 0],
			['Kept', 'Parent', 1],
			['Orphan', null, 0],
		]);
	});
});
