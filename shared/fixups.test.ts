import { describe, expect, test } from 'bun:test';
import { fixups } from './fixups.ts';
import { label, project, section, snapshotOf, task } from './testing.ts';

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

	describe('sections', () => {
		test('a project merge carries its sections, and same-named sections then merge into the oldest', () => {
			const fixed = fixups(
				snapshotOf({
					projects: [project('a', { name: 'Home', createdAt: 1 }), project('b', { name: 'home', createdAt: 2 })],
					sections: [
						section('later-a', 'a', { name: 'Later' }),
						section('later-b', 'b', { name: 'later', createdAt: 2 }),
						section('next', 'b'),
					],
					tasks: [
						task('t', { projectId: 'b', sectionId: 'later-b' }),
						task('u', { projectId: 'b', sectionId: 'next' }),
					],
				}),
			);
			expect(fixed.sections.map(s => [s.id, s.projectId])).toEqual([
				['later-a', 'a'],
				['next', 'a'],
			]);
			expect(fixed.tasks.map(t => [t.id, t.projectId, t.sectionId])).toEqual([
				['t', 'a', 'later-a'],
				['u', 'a', 'next'],
			]);
		});

		test('sections from the same Todoist import merge by source key', () => {
			const fixed = fixups(
				snapshotOf({
					projects: [project('p')],
					sections: [
						section('mac', 'p', { name: 'Later', sourceKey: 'todoist:section:1:Later', createdAt: 1 }),
						section('phone', 'p', { name: 'Later (2)', sourceKey: 'todoist:section:1:Later', createdAt: 2 }),
					],
					tasks: [task('t', { projectId: 'p', sectionId: 'phone' })],
				}),
			);
			expect(fixed.sections.map(s => s.id)).toEqual(['mac']);
			expect(fixed.tasks[0]!.sectionId).toBe('mac');
		});

		test('a section added to a project deleted elsewhere is deleted too', () => {
			const fixed = fixups(snapshotOf({ sections: [section('s', 'gone')] }));
			expect(fixed.sections).toEqual([]);
		});

		test('a task moved into a section deleted elsewhere stays in its project in no section', () => {
			const fixed = fixups(
				snapshotOf({ projects: [project('p')], tasks: [task('t', { projectId: 'p', sectionId: 'gone' })] }),
			);
			expect(fixed.tasks.map(t => [t.projectId, t.sectionId])).toEqual([['p', null]]);
		});

		test('a task moved to another project leaves the section it had', () => {
			const fixed = fixups(
				snapshotOf({
					projects: [project('p'), project('q')],
					sections: [section('s', 'p')],
					tasks: [task('t', { projectId: 'q', sectionId: 's' })],
				}),
			);
			expect(fixed.tasks[0]!.sectionId).toBeNull();
		});

		test('a subtask sits in no section, since it shows under its parent', () => {
			const fixed = fixups(
				snapshotOf({
					projects: [project('p')],
					sections: [section('s', 'p')],
					tasks: [
						task('root', { projectId: 'p', sectionId: 's' }),
						task('child', { parentId: 'root', projectId: 'p', sectionId: 's' }),
					],
				}),
			);
			expect(fixed.tasks.map(t => [t.id, t.sectionId])).toEqual([
				['root', 's'],
				['child', null],
			]);
		});
	});
});
