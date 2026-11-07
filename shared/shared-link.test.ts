import { expect } from 'bun:test';
import * as link from './shared-link.ts';
import type { SharedView } from './sharing.ts';
import { label, project, task } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const sharedGroups = recorded('shared-link', link.sharedGroups);
const sharedTitle = recorded('shared-link', link.sharedTitle);

const owner = { id: 'ann', name: 'Ann', kind: 'human' as const, ownerId: null };
const view = (target: SharedView['target'], fields: Partial<SharedView> = {}): SharedView => ({
	target,
	owner,
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	...fields,
});
const titles = (groups: ReturnType<typeof link.sharedGroups>) => groups.map(g => g.tasks.map(t => t.title));

describe('shared link', () => {
	test('a label lists its open tasks, with a shared subtask under its parent instead of beside it', () => {
		const tasks = [
			task('a', { title: 'Call mom', labelIds: ['calls'] }),
			task('b', { title: 'Ask about dinner', parentId: 'a' }),
			task('c', { title: 'Lone subtask', parentId: 'hidden' }),
			task('d', { title: 'Done', labelIds: ['calls'], completedAt: 5 }),
		];
		const shared = view({ kind: 'label', id: 'calls' }, { tasks, labels: [label('calls', { name: 'calls' })] });
		expect(titles(sharedGroups(shared))).toEqual([['Call mom', 'Lone subtask']]);
		expect(sharedTitle(shared)).toBe('calls');
	});

	test('a project lists under its sections and is titled by name', () => {
		const shared = view(
			{ kind: 'project', id: 'home' },
			{
				projects: [project('home', { name: 'Home' })],
				tasks: [task('a', { title: 'Mop', projectId: 'home' })],
			},
		);
		expect(titles(sharedGroups(shared))).toEqual([['Mop']]);
		expect(sharedTitle(shared)).toBe('Home');
	});

	test('a task and a space are titled by the task and the owner', () => {
		expect(sharedTitle(view({ kind: 'task', id: 'a' }, { tasks: [task('a', { title: 'Mop' })] }))).toBe('Mop');
		expect(sharedTitle(view({ kind: 'space', id: 'ann' }))).toBe('Ann’s tasks');
		expect(sharedTitle(view({ kind: 'label', id: 'gone' }))).toBe('Shared label');
	});
});
