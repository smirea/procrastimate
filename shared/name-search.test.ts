import { describe, expect, test } from 'bun:test';
import {
	labelIdsOf,
	lastUsed,
	projectIdsOf,
	sigilFragment,
	suggest,
	type Named,
	type Suggestion,
} from './name-search.ts';
import type { Project, Task } from './task.ts';

const project = (id: string, name: string): Project => ({ id, name, createdAt: 0 });
const projects = [
	project('home', 'Home'),
	project('homework', 'Homework'),
	project('side', 'Side Project'),
	project('errands', 'Errands'),
	project('work', 'Work'),
];
const labels = [project('waiting', 'waiting'), project('calls', 'calls'), project('deep', 'deep work')];

const task = (projectId: string | null, createdAt: number, labelIds: string[] = []): Task => ({
	id: `${projectId}-${createdAt}`,
	title: 't',
	notes: '',
	projectId,
	labelIds,
	due: null,
	recurrence: null,
	priority: 4,
	reminders: [],
	createdAt,
	completedAt: null,
});

const names = (suggestions: Suggestion<Named>[]) =>
	suggestions.map(s => (s.kind === 'existing' ? s.item.name : `+${s.name}`));

const suggestProjects = (tasks: Task[], query: string, items = projects) =>
	names(suggest(items, lastUsed(tasks, projectIdsOf), query));
const suggestLabels = (tasks: Task[], query: string) => names(suggest(labels, lastUsed(tasks, labelIdsOf), query));

describe('sigilFragment', () => {
	test.each([
		['Fix sink #ho', 12, { start: 9, end: 12, query: 'ho' }],
		['#', 1, { start: 0, end: 1, query: '' }],
		['Fix #ho sink', 7, { start: 4, end: 7, query: 'ho' }],
		['Fix #home sink', 6, { start: 4, end: 9, query: 'h' }],
		['Fix sink #Side Pr', 17, { start: 9, end: 17, query: 'Side Pr' }],
	])('# in %p with the caret at %p', (value, caret, expected) => {
		expect(sigilFragment(value, caret, '#', projects)).toEqual(expected);
	});

	test.each([
		['Fix sink', 8],
		['Issue#12', 8],
		['Fix #home sink', 14],
		['#Home ', 6],
		['#zz top', 7],
	])('# in %p with the caret at %p has no fragment', (value, caret) => {
		expect(sigilFragment(value, caret, '#', projects)).toBeNull();
	});

	test.each([
		['Call bob @ca', 12, { start: 9, end: 12, query: 'ca' }],
		['@', 1, { start: 0, end: 1, query: '' }],
		['Plan @deep wo', 13, { start: 5, end: 13, query: 'deep wo' }],
	])('@ in %p with the caret at %p', (value, caret, expected) => {
		expect(sigilFragment(value, caret, '@', labels)).toEqual(expected);
	});

	test.each([
		['Email a@b.com', 13],
		['ping foo@bar', 12],
		['Fix sink #ca', 12],
		['@calls now', 10],
	])('@ in %p with the caret at %p has no fragment', (value, caret) => {
		expect(sigilFragment(value, caret, '@', labels)).toBeNull();
	});
});

describe('suggest', () => {
	test('an empty query lists everything, most recently used first, then alphabetical', () => {
		const tasks = [task('work', 5), task('errands', 9), task('work', 2)];
		expect(suggestProjects(tasks, '')).toEqual(['Errands', 'Work', 'Home', 'Homework', 'Side Project']);
	});

	test('an exact match beats a prefix, a prefix beats a word prefix, and a word prefix beats a substring', () => {
		const all = [...projects, project('chores', 'Chores at home'), project('ohm', 'Ohms')];
		expect(suggestProjects([], 'home', all)).toEqual(['Home', 'Homework', 'Chores at home']);
		expect(suggestProjects([], 'pro', all)).toEqual(['Side Project', '+pro']);
		expect(suggestProjects([], 'o', all)).toEqual([
			'Ohms',
			'Chores at home',
			'Home',
			'Homework',
			'Side Project',
			'Work',
			'+o',
		]);
	});

	test('recency breaks ties within a match tier', () => {
		expect(suggestProjects([task('homework', 1)], 'ho')).toEqual(['Homework', 'Home', '+ho']);
	});

	test('matching is case-insensitive and an exact match hides the create option', () => {
		expect(suggestProjects([], 'WORK')).toEqual(['Work', 'Homework']);
	});

	test('a query with no match offers only to create it, keeping its casing', () => {
		expect(suggestProjects([], 'Garden ')).toEqual(['+Garden']);
	});

	test('a label counts as used by every task that carries it, whatever its project', () => {
		const tasks = [task('home', 3, ['calls']), task(null, 7, ['waiting', 'deep']), task('work', 5, ['calls'])];
		expect(suggestLabels(tasks, '')).toEqual(['deep work', 'waiting', 'calls']);
		expect(suggestLabels([task(null, 1, ['calls'])], '')).toEqual(['calls', 'deep work', 'waiting']);
		expect(suggestLabels(tasks, 'w')).toEqual(['waiting', 'deep work', '+w']);
	});
});
