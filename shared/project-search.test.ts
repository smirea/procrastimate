import { describe, expect, test } from 'bun:test';
import { hashFragment, suggestProjects, type ProjectSuggestion } from './project-search.ts';
import type { Project, Task } from './task.ts';

const project = (id: string, name: string): Project => ({ id, name, createdAt: 0 });
const projects = [
	project('home', 'Home'),
	project('homework', 'Homework'),
	project('side', 'Side Project'),
	project('errands', 'Errands'),
	project('work', 'Work'),
];

const task = (projectId: string | null, createdAt: number): Task => ({
	id: `${projectId}-${createdAt}`,
	title: 't',
	notes: '',
	projectId,
	due: null,
	priority: 4,
	reminders: [],
	createdAt,
	completedAt: null,
});

const names = (suggestions: ProjectSuggestion[]) =>
	suggestions.map(s => (s.kind === 'project' ? s.project.name : `+${s.name}`));

describe('hashFragment', () => {
	test.each([
		['Fix sink #ho', 12, { start: 9, end: 12, query: 'ho' }],
		['#', 1, { start: 0, end: 1, query: '' }],
		['Fix #ho sink', 7, { start: 4, end: 7, query: 'ho' }],
		['Fix #home sink', 6, { start: 4, end: 9, query: 'h' }],
		['Fix sink #Side Pr', 17, { start: 9, end: 17, query: 'Side Pr' }],
	])('%p with the caret at %p', (value, caret, expected) => {
		expect(hashFragment(value, caret, projects)).toEqual(expected);
	});

	test.each([
		['Fix sink', 8],
		['Issue#12', 8],
		['Fix #home sink', 14],
		['#Home ', 6],
		['#zz top', 7],
	])('%p with the caret at %p has no fragment', (value, caret) => {
		expect(hashFragment(value, caret, projects)).toBeNull();
	});
});

describe('suggestProjects', () => {
	test('an empty query lists every project, most recently used first, then alphabetical', () => {
		const tasks = [task('work', 5), task('errands', 9), task('work', 2)];
		expect(names(suggestProjects(projects, tasks, ''))).toEqual([
			'Errands',
			'Work',
			'Home',
			'Homework',
			'Side Project',
		]);
	});

	test('an exact match beats a prefix, a prefix beats a word prefix, and a word prefix beats a substring', () => {
		const all = [...projects, project('chores', 'Chores at home'), project('ohm', 'Ohms')];
		expect(names(suggestProjects(all, [], 'home'))).toEqual(['Home', 'Homework', 'Chores at home']);
		expect(names(suggestProjects(all, [], 'pro'))).toEqual(['Side Project', '+pro']);
		expect(names(suggestProjects(all, [], 'o'))).toEqual([
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
		expect(names(suggestProjects(projects, [task('homework', 1)], 'ho'))).toEqual(['Homework', 'Home', '+ho']);
	});

	test('matching is case-insensitive and an exact match hides the create option', () => {
		expect(names(suggestProjects(projects, [], 'WORK'))).toEqual(['Work', 'Homework']);
	});

	test('a query with no match offers only to create it, keeping its casing', () => {
		expect(names(suggestProjects(projects, [], 'Garden '))).toEqual(['+Garden']);
	});
});
