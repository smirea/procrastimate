import { describe, expect, test } from 'bun:test';
import { label, project, section, task } from 'shared/sync/testing.ts';
import { creationHome, emptySection, fitToSpace, homes, merged } from './spaces.ts';

const ann = { id: 'ann', name: 'Ann', kind: 'human' as const, ownerId: null };
const spaces = {
	ann: {
		...emptySection(ann),
		tasks: [task('shared-task', { projectId: 'groceries', createdAt: 5 })],
		projects: [project('groceries')],
		sections: [section('aisle', 'groceries')],
		labels: [label('errands')],
	},
};
const own = {
	tasks: [task('mine', { createdAt: 3 })],
	projects: [project('work')],
	sections: [section('later', 'work')],
	labels: [label('home')],
	comments: [],
	reads: [],
};
const homeOf = (id: string) => homes(spaces).get(id) ?? null;

describe('creationHome', () => {
	test('a subtask lands in its parent’s space even when its project is the user’s own', () => {
		expect(creationHome(homeOf, { projectId: 'work', labelIds: [] }, 'shared-task')).toBe('ann');
	});

	test('a top-level task lands in its project’s space', () => {
		expect(creationHome(homeOf, { projectId: 'groceries', labelIds: ['home'] }, null)).toBe('ann');
		expect(creationHome(homeOf, { projectId: 'work', labelIds: ['errands'] }, null)).toBeNull();
	});

	test('without a project, a shared label decides', () => {
		expect(creationHome(homeOf, { projectId: null, labelIds: ['home', 'errands'] }, null)).toBe('ann');
		expect(creationHome(homeOf, { projectId: null, labelIds: ['home'] }, null)).toBeNull();
	});
});

test('fitToSpace drops the project, section, and labels of other spaces', () => {
	const input = {
		projectId: 'work' as string | null,
		sectionId: 'later' as string | null,
		labelIds: ['home', 'errands'],
	};
	expect(fitToSpace(spaces.ann, input)).toEqual({ projectId: null, sectionId: null, labelIds: ['errands'] });
	expect(fitToSpace(spaces.ann, { projectId: 'groceries', sectionId: 'aisle', labelIds: [] })).toEqual({
		projectId: 'groceries',
		sectionId: 'aisle',
		labelIds: [],
	});
});

test('merged lists own data first and keeps tasks in creation order', () => {
	const view = merged({ ...own, tasks: [...own.tasks, task('late', { createdAt: 9 })] }, spaces);
	expect(view.tasks.map(t => t.id)).toEqual(['mine', 'shared-task', 'late']);
	expect(view.projects.map(p => p.id)).toEqual(['work', 'groceries']);
	expect(view.sections.map(s => s.id)).toEqual(['later', 'aisle']);
	expect(homeOf('aisle')).toBe('ann');
	expect(view.labels.map(l => l.id)).toEqual(['home', 'errands']);
});
