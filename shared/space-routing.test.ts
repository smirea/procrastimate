import { expect } from 'bun:test';
import type { Person } from './sharing.ts';
import * as routing from './space-routing.ts';
import type { NewTask } from './store.ts';
import { label, project, section, task } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const creationHome = recorded('space-routing', routing.creationHome);
const fitToSpace = recorded('space-routing', routing.fitToSpace);
const fitPatch = recorded('space-routing', routing.fitPatch);
const sharedEntries = recorded('space-routing', routing.sharedEntries);

const homes = { 'ann-task': 'ann', 'ann-project': 'ann', 'ann-label': 'ann', 'bo-label': 'bo' };
const lists = {
	projects: [project('work')],
	sections: [section('later', 'work')],
	labels: [label('home')],
};
const newTask = (fields: Pick<NewTask, 'projectId' | 'sectionId' | 'labelIds'> & { title: string }) => fields;
const person = (id: string, name: string): Person => ({ id, name, kind: 'human', ownerId: null });

describe('creationHome', () => {
	test('a subtask goes where its parent is, whatever its project or labels say', () => {
		expect(creationHome(homes, { projectId: null, labelIds: ['bo-label'] }, 'ann-task')).toBe('ann');
		expect(creationHome(homes, { projectId: 'ann-project', labelIds: [] }, 'mine')).toBeNull();
	});

	test('a top-level task goes to its project’s space, else its first shared label’s, else the user’s own', () => {
		expect(creationHome(homes, { projectId: 'ann-project', labelIds: ['bo-label'] }, null)).toBe('ann');
		expect(creationHome(homes, { projectId: null, labelIds: ['mine', 'bo-label', 'ann-label'] }, null)).toBe('bo');
		expect(creationHome(homes, { projectId: 'work', labelIds: ['bo-label'] }, null)).toBeNull();
		expect(creationHome(homes, { projectId: null, labelIds: [] }, null)).toBeNull();
	});
});

describe('fitToSpace', () => {
	test('a new task keeps only the project, section, and labels of its space', () => {
		expect(
			fitToSpace(
				lists,
				newTask({ title: 'Plan', projectId: 'elsewhere', sectionId: 'later', labelIds: ['home', 'theirs'] }),
			),
		).toEqual({ title: 'Plan', projectId: null, sectionId: 'later', labelIds: ['home'] });
		expect(fitToSpace(lists, newTask({ title: 'Plan', projectId: 'work', sectionId: 'gone', labelIds: [] }))).toEqual({
			title: 'Plan',
			projectId: 'work',
			sectionId: null,
			labelIds: [],
		});
	});
});

describe('fitPatch', () => {
	test('a move into another space’s project or section leaves the task where it is, and its labels drop', () => {
		expect(
			fitPatch(lists, { title: 'Moved', projectId: 'theirs', sectionId: 'theirs', labelIds: ['home', 'x'] }),
		).toEqual({ title: 'Moved', labelIds: ['home'] });
	});

	test('a move within the space, or out of every project, applies', () => {
		expect(fitPatch(lists, { projectId: 'work', sectionId: 'later' })).toEqual({
			projectId: 'work',
			sectionId: 'later',
		});
		expect(fitPatch(lists, { projectId: null, sectionId: null, priority: 1 })).toEqual({
			projectId: null,
			sectionId: null,
			priority: 1,
		});
	});
});

describe('sharedEntries', () => {
	test('spaces by owner name, then projects in order, labels by name, and the tasks no project or label leads to', () => {
		const ann = person('ann', 'Ann');
		const zed = person('a-zed', 'Zed');
		expect(
			sharedEntries([
				{ owner: zed, data: { tasks: [task('z', { title: 'Zed’s' })], projects: [], labels: [] } },
				{
					owner: ann,
					data: {
						projects: [project('second', { name: 'Second', order: 2 }), project('first', { name: 'First', order: 1 })],
						labels: [label('errands', { name: 'errands' }), label('book', { name: 'Books' })],
						tasks: [
							task('in-project', { projectId: 'first' }),
							task('labelled', { labelIds: ['errands'] }),
							task('alone', { title: 'Call mum' }),
							task('sub', { parentId: 'alone' }),
						],
					},
				},
			]),
		).toEqual([
			{ kind: 'project', id: 'first', name: 'First', owner: ann },
			{ kind: 'project', id: 'second', name: 'Second', owner: ann },
			{ kind: 'label', id: 'book', name: 'Books', owner: ann },
			{ kind: 'label', id: 'errands', name: 'errands', owner: ann },
			{ kind: 'task', id: 'alone', name: 'Call mum', owner: ann },
			{ kind: 'task', id: 'z', name: 'Zed’s', owner: zed },
		]);
	});
});
