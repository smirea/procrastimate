import { expect } from 'bun:test';
import * as dangling from './dangling.ts';
import { label, project, section, task } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const resolveDangling = recorded('dangling', dangling.resolveDangling);

const data = (fields: Partial<dangling.Entities>): dangling.Entities => ({
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	...fields,
});

describe('resolveDangling', () => {
	test('leaves consistent data alone, as the same object', () => {
		const input = data({
			projects: [project('p')],
			sections: [section('s', 'p')],
			labels: [label('l')],
			tasks: [
				task('a', { projectId: 'p', sectionId: 's', labelIds: ['l'] }),
				task('b', { parentId: 'a', projectId: 'p' }),
			],
		});
		expect(resolveDangling(input)).toBe(input);
	});

	test('a subtask whose parent is gone, or whose parents loop, reads as top level', () => {
		const { tasks } = resolveDangling(
			data({
				tasks: [task('orphan', { parentId: 'deleted' }), task('x', { parentId: 'y' }), task('y', { parentId: 'x' })],
			}),
		);
		expect(tasks.map(t => t.parentId)).toEqual([null, null, null]);
	});

	test('a task in a deleted project reads as in Inbox', () => {
		const { tasks } = resolveDangling(data({ tasks: [task('a', { projectId: 'gone' })] }));
		expect(tasks).toEqual([task('a')]);
	});

	test('a subtask takes its root’s project, also when its own project is gone', () => {
		const { tasks } = resolveDangling(
			data({
				projects: [project('work'), project('home')],
				tasks: [
					task('root', { projectId: 'work' }),
					task('child', { parentId: 'root', projectId: 'home' }),
					task('grandchild', { parentId: 'child', projectId: 'gone' }),
				],
			}),
		);
		expect(tasks.map(t => t.projectId)).toEqual(['work', 'work', 'work']);
	});

	test('a section of a deleted project is dropped, and its tasks read as in no section', () => {
		const { sections, tasks } = resolveDangling(
			data({
				projects: [project('p')],
				sections: [section('live', 'p'), section('dead', 'gone')],
				tasks: [task('a', { projectId: 'gone', sectionId: 'dead' }), task('b', { projectId: 'p', sectionId: 'live' })],
			}),
		);
		expect(sections.map(s => s.id)).toEqual(['live']);
		expect(tasks.map(t => [t.projectId, t.sectionId])).toEqual([
			[null, null],
			['p', 'live'],
		]);
	});

	test('a task keeps its section only while it is top level and the section is in its project', () => {
		const { tasks } = resolveDangling(
			data({
				projects: [project('p'), project('q')],
				sections: [section('s', 'p')],
				tasks: [
					task('moved', { projectId: 'q', sectionId: 's' }),
					task('parent', { projectId: 'p' }),
					task('child', { parentId: 'parent', projectId: 'p', sectionId: 's' }),
					task('missing', { projectId: 'p', sectionId: 'deleted' }),
				],
			}),
		);
		expect(tasks.map(t => t.sectionId)).toEqual([null, null, null, null]);
	});

	test('a deleted label leaves every labelIds', () => {
		const { tasks } = resolveDangling(
			data({ labels: [label('kept')], tasks: [task('a', { labelIds: ['gone', 'kept', 'other'] })] }),
		);
		expect(tasks[0]!.labelIds).toEqual(['kept']);
	});
});
