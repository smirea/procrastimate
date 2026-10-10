import { describe, expect, test } from 'bun:test';
import { fixups } from './fixups.ts';
import { label, project, snapshotOf, task } from './testing.ts';

describe('fixups', () => {
	test('leaves a consistent snapshot alone', () => {
		const snapshot = snapshotOf({
			projects: [project('p')],
			labels: [label('l')],
			tasks: [task('a', { projectId: 'p', labelIds: ['l'] }), task('b', { parentId: 'a', projectId: 'p' })],
		});
		expect(fixups(snapshot)).toEqual(snapshot);
	});

	test('a subtask added under a task deleted elsewhere becomes top level', () => {
		const { tasks } = fixups(snapshotOf({ tasks: [task('child', { parentId: 'deleted' })] }));
		expect(tasks).toEqual([task('child')]);
	});

	test('tasks whose parents loop become top level', () => {
		const { tasks } = fixups(snapshotOf({ tasks: [task('a', { parentId: 'b' }), task('b', { parentId: 'a' })] }));
		expect(tasks.map(t => t.parentId)).toEqual([null, null]);
	});

	test('an open subtask under a completed parent reopens the parent and its completed ancestors', () => {
		const { tasks } = fixups(
			snapshotOf({
				tasks: [
					task('root', { completedAt: 5 }),
					task('mid', { parentId: 'root', completedAt: 5 }),
					task('done', { parentId: 'mid', completedAt: 5 }),
					task('new', { parentId: 'mid' }),
				],
			}),
		);
		expect(Object.fromEntries(tasks.map(t => [t.id, t.completedAt]))).toEqual({
			root: null,
			mid: null,
			done: 5,
			new: null,
		});
	});

	test('a subtask takes its root task’s project', () => {
		const { tasks } = fixups(
			snapshotOf({
				projects: [project('home'), project('work')],
				tasks: [
					task('root', { projectId: 'work' }),
					task('child', { parentId: 'root', projectId: 'home' }),
					task('grandchild', { parentId: 'child', projectId: null }),
				],
			}),
		);
		expect(tasks.map(t => t.projectId)).toEqual(['work', 'work', 'work']);
	});

	test('a task in a deleted project lands in Inbox', () => {
		const { tasks } = fixups(
			snapshotOf({
				tasks: [task('moved', { projectId: 'deleted' }), task('sub', { parentId: 'moved', projectId: 'deleted' })],
			}),
		);
		expect(tasks.map(t => t.projectId)).toEqual([null, null]);
	});

	test('a deleted label comes off every task', () => {
		const { tasks } = fixups(
			snapshotOf({ labels: [label('kept')], tasks: [task('t', { labelIds: ['gone', 'kept'] })] }),
		);
		expect(tasks[0]?.labelIds).toEqual(['kept']);
	});

	test('labels with the same name ignoring case merge into the oldest', () => {
		const { labels, tasks } = fixups(
			snapshotOf({
				labels: [label('new', { name: 'Work', createdAt: 2 }), label('old', { name: 'work', createdAt: 1 })],
				tasks: [task('a', { labelIds: ['new'] }), task('b', { labelIds: ['old', 'new'] })],
			}),
		);
		expect(labels.map(l => l.id)).toEqual(['old']);
		expect(tasks.map(t => t.labelIds)).toEqual([['old'], ['old']]);
	});

	test('a tie in creation time keeps the lowest id', () => {
		const { labels } = fixups(snapshotOf({ labels: [label('b', { name: 'X' }), label('a', { name: 'x' })] }));
		expect(labels.map(l => l.id)).toEqual(['a']);
	});

	test('a rename that collides with a create on another device merges the projects and moves their tasks', () => {
		const { projects, tasks } = fixups(
			snapshotOf({
				projects: [
					project('renamed', { name: 'Errands', createdAt: 1 }),
					project('created', { name: 'errands', createdAt: 3 }),
				],
				tasks: [task('t', { projectId: 'created' }), task('sub', { parentId: 't', projectId: 'created' })],
			}),
		);
		expect(projects.map(p => p.id)).toEqual(['renamed']);
		expect(tasks.map(t => t.projectId)).toEqual(['renamed', 'renamed']);
	});

	test('a Todoist import on two devices merges by source key', () => {
		const copy = (suffix: string, createdAt: number) => [
			task(`root-${suffix}`, { sourceKey: 'todoist:task:1', projectId: `p-${suffix}`, createdAt }),
			task(`sub-${suffix}`, {
				sourceKey: 'todoist:task:2',
				parentId: `root-${suffix}`,
				projectId: `p-${suffix}`,
				createdAt,
			}),
			task(`mine-${suffix}`, { parentId: `root-${suffix}`, projectId: `p-${suffix}`, createdAt }),
		];
		const { projects, tasks } = fixups(
			snapshotOf({
				projects: [
					project('p-b', { name: 'Imported', sourceKey: 'todoist:project:1', createdAt: 2 }),
					project('p-a', { name: 'Imported', sourceKey: 'todoist:project:1', createdAt: 1 }),
				],
				tasks: [...copy('b', 2), ...copy('a', 1)],
			}),
		);
		expect(projects.map(p => p.id)).toEqual(['p-a']);
		expect(tasks.map(t => [t.id, t.parentId, t.projectId])).toEqual([
			['mine-b', 'root-a', 'p-a'],
			['root-a', null, 'p-a'],
			['sub-a', 'root-a', 'p-a'],
			['mine-a', 'root-a', 'p-a'],
		]);
	});

	test('two hand-typed tasks with the same title stay two tasks', () => {
		const { tasks } = fixups(snapshotOf({ tasks: [task('a', { title: 'Milk' }), task('b', { title: 'Milk' })] }));
		expect(tasks).toHaveLength(2);
	});

	test('running twice changes nothing more', () => {
		const once = fixups(
			snapshotOf({
				projects: [project('p', { name: 'A' }), project('q', { name: 'a', createdAt: 2 })],
				labels: [label('l')],
				tasks: [
					task('x', { projectId: 'q', completedAt: 3, labelIds: ['l', 'gone'] }),
					task('y', { parentId: 'x', projectId: null }),
					task('z', { parentId: 'missing' }),
				],
			}),
		);
		expect(fixups(once)).toEqual(once);
	});
});
