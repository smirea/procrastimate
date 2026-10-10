import { beforeEach, describe, expect, test } from 'bun:test';
import { loadSnapshot } from './persistence.ts';

const storage = new Map<string, string>();
globalThis.localStorage = {
	getItem: key => storage.get(key) ?? null,
	setItem: (key, value) => void storage.set(key, value),
} as Storage;

const task = (id: string, recurrence: unknown) => ({
	id,
	title: id,
	notes: '',
	projectId: null,
	due: { date: '2026-10-14', time: null },
	recurrence,
	priority: 4,
	reminders: [],
	createdAt: 1,
	completedAt: null,
});

describe('loadSnapshot', () => {
	beforeEach(() => storage.clear());

	test('a task with an empty repeat interval is dropped and every other task is kept', () => {
		storage.set(
			'procrastimate',
			JSON.stringify({
				tasks: [task('Good', { interval: 2, unit: 'day' }), task('Bad', { interval: null, unit: 'day' })],
				projects: [{ id: 'p', name: 'Home', createdAt: 1 }],
				remindersCheckedAt: 5,
			}),
		);
		const snapshot = loadSnapshot(10);
		expect(snapshot.tasks.map(t => t.title)).toEqual(['Good']);
		expect(snapshot.projects.map(p => p.name)).toEqual(['Home']);
		expect(snapshot.remindersCheckedAt).toBe(5);
	});

	test('a store saved before labels existed loads every task with no labels', () => {
		storage.set('procrastimate', JSON.stringify({ tasks: [task('Old', null)], projects: [], remindersCheckedAt: 5 }));
		const snapshot = loadSnapshot(10);
		expect(snapshot.tasks.map(t => [t.title, t.labelIds])).toEqual([['Old', []]]);
		expect(snapshot.labels).toEqual([]);
	});

	test('labels and the labels on each task round-trip', () => {
		storage.set(
			'procrastimate',
			JSON.stringify({
				tasks: [{ ...task('Call', null), labelIds: ['l'] }],
				projects: [],
				labels: [{ id: 'l', name: 'calls', createdAt: 1 }],
				remindersCheckedAt: 5,
			}),
		);
		const snapshot = loadSnapshot(10);
		expect(snapshot.tasks[0]!.labelIds).toEqual(['l']);
		expect(snapshot.labels).toEqual([{ id: 'l', name: 'calls', createdAt: 1 }]);
	});

	test('a weekday set survives a reload, and stored repeats without one still load', () => {
		storage.set(
			'procrastimate',
			JSON.stringify({
				tasks: [
					task('Gym', { interval: 1, unit: 'week', days: [5, 1, 3] }),
					task('Review', { interval: 1, unit: 'week' }),
					task('Water', { interval: 2, unit: 'day' }),
					task('Old', undefined),
					task('Empty set', { interval: 1, unit: 'week', days: [] }),
					task('Days on a daily repeat', { interval: 1, unit: 'day', days: [1] }),
				],
				projects: [],
				remindersCheckedAt: 5,
			}),
		);
		expect(loadSnapshot(10).tasks.map(t => [t.title, t.recurrence])).toEqual([
			['Gym', { interval: 1, unit: 'week', days: [1, 3, 5] }],
			['Review', { interval: 1, unit: 'week' }],
			['Water', { interval: 2, unit: 'day' }],
			['Old', null],
			['Days on a daily repeat', { interval: 1, unit: 'day' }],
		]);
	});
});
