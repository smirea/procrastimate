import { describe, expect, test } from 'bun:test';
import { label, project, task } from 'shared/sync/testing.ts';
import { creationHome, emptySection, fitToSpace, homes, merged } from './spaces.ts';

const ann = { id: 'ann', name: 'Ann', kind: 'human' as const, ownerId: null };
const spaces = {
	ann: {
		...emptySection(ann),
		tasks: [task('shared-task', { projectId: 'groceries', createdAt: 5 })],
		projects: [project('groceries')],
		labels: [label('errands')],
	},
};
const own = { tasks: [task('mine', { createdAt: 3 })], projects: [project('work')], labels: [label('home')] };
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

test('fitToSpace drops the project and labels of other spaces', () => {
	expect(fitToSpace(spaces.ann, { projectId: 'work' as string | null, labelIds: ['home', 'errands'] })).toEqual({
		projectId: null,
		labelIds: ['errands'],
	});
	expect(fitToSpace(spaces.ann, { projectId: 'groceries', labelIds: [] })).toEqual({
		projectId: 'groceries',
		labelIds: [],
	});
});

test('merged lists own data first and keeps tasks in creation order', () => {
	const view = merged({ ...own, tasks: [...own.tasks, task('late', { createdAt: 9 })] }, spaces);
	expect(view.tasks.map(t => t.id)).toEqual(['mine', 'shared-task', 'late']);
	expect(view.projects.map(p => p.id)).toEqual(['work', 'groceries']);
	expect(view.labels.map(l => l.id)).toEqual(['home', 'errands']);
});
