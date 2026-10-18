import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from 'shared/model.ts';
import { label, project, section, task } from 'shared/testing.ts';
import type { Rows } from './database.ts';
import {
	creationHome,
	emptyData,
	fitToSpace,
	group,
	homes,
	merged,
	sharedEntries,
	type SharedSpace,
} from './spaces.ts';

const ann = { id: 'ann', name: 'Ann', kind: 'human' as const, ownerId: null };
const spaces: Record<string, SharedSpace> = {
	ann: {
		owner: 'ann',
		readOnly: new Set(),
		access: [],
		data: {
			...emptyData(),
			tasks: [task('shared-task', { projectId: 'groceries', createdAt: 5 })],
			projects: [project('groceries')],
			sections: [section('aisle', 'groceries')],
			labels: [label('errands')],
		},
	},
};
const own = {
	...emptyData(),
	tasks: [task('mine', { createdAt: 3 })],
	projects: [project('work')],
	sections: [section('later', 'work')],
	labels: [label('home')],
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
	expect(fitToSpace(spaces.ann!.data, input)).toEqual({ projectId: null, sectionId: null, labelIds: ['errands'] });
	expect(fitToSpace(spaces.ann!.data, { projectId: 'groceries', sectionId: 'aisle', labelIds: [] })).toEqual({
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

const row = <T extends { id: string }>(userId: string, entity: T) => ({ ...entity, userId, sourceKey: null });
const rows = (fields: Partial<Rows>): Rows => ({
	task: [],
	project: [],
	section: [],
	label: [],
	comment: [],
	read: [],
	settings: [],
	access: [],
	...fields,
});

describe('group', () => {
	test('splits rows by owner, sorts them by creation, and marks the tasks shared read only', () => {
		const grouped = group(
			rows({
				task: [
					row('me', task('later', { createdAt: 9 })),
					row('ann', task('hers', { createdAt: 2 })),
					row('me', task('first', { createdAt: 1 })),
				],
				project: [row('ann', project('groceries'))],
				read: [row('me', { id: 'hers', readAt: 4 })],
				access: [
					{ id: 'me:task:hers', grantee: 'me', owner: 'ann', kind: 'task', entityId: 'hers', role: 'view' },
					{
						id: 'me:project:groceries',
						grantee: 'me',
						owner: 'ann',
						kind: 'project',
						entityId: 'groceries',
						role: 'edit',
					},
				],
			}),
			'me',
		);
		expect(grouped.own.tasks.map(t => t.id)).toEqual(['first', 'later']);
		expect(grouped.own.reads).toEqual([{ id: 'hers', readAt: 4 }]);
		expect(grouped.own.tasks[0]).toEqual(task('first', { createdAt: 1 }));
		expect(grouped.settings).toBeNull();
		expect(Object.keys(grouped.spaces)).toEqual(['ann']);
		expect(grouped.spaces.ann!.data.tasks.map(t => t.id)).toEqual(['hers']);
		expect(grouped.spaces.ann!.data.projects.map(p => p.id)).toEqual(['groceries']);
		expect([...grouped.spaces.ann!.readOnly]).toEqual(['hers']);
	});

	test('reads the own settings row, and drops a row that does not parse instead of the load', () => {
		const grouped = group(
			rows({
				task: [row('me', task('kept')), row('me', { ...task('broken'), priority: 'urgent' })],
				settings: [{ userId: 'me', id: 'settings', ...DEFAULT_SETTINGS, dictation: 'elevenlabs' }],
			}),
			'me',
		);
		expect(grouped.own.tasks.map(t => t.id)).toEqual(['kept']);
		expect(grouped.settings).toEqual({ ...DEFAULT_SETTINGS, dictation: 'elevenlabs' });
	});

	test('an owner who shares nothing visible yet still has a space', () => {
		const grouped = group(
			rows({
				access: [{ id: 'me:project:p', grantee: 'me', owner: 'ann', kind: 'project', entityId: 'p', role: 'edit' }],
			}),
			'me',
		);
		expect(grouped.spaces.ann!.data).toEqual(emptyData());
	});
});

test('sharedEntries lists every shared project and label, and only the tasks neither leads to', () => {
	const space: SharedSpace = {
		owner: 'ann',
		readOnly: new Set(),
		access: [],
		data: {
			...emptyData(),
			projects: [project('groceries', { name: 'Groceries' })],
			labels: [label('errands', { name: 'Errands' })],
			tasks: [
				task('in-project', { projectId: 'groceries' }),
				task('labelled', { labelIds: ['errands'] }),
				task('alone', { title: 'Call mum' }),
				task('sub', { parentId: 'alone' }),
			],
		},
	};
	expect(sharedEntries({ ann: space }, () => ann)).toEqual([
		{ kind: 'project', id: 'groceries', name: 'Groceries', owner: ann },
		{ kind: 'label', id: 'errands', name: 'Errands', owner: ann },
		{ kind: 'task', id: 'alone', name: 'Call mum', owner: ann },
	]);
});
