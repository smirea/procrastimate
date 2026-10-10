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
});
