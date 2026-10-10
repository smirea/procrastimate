import { describe, expect, test } from 'bun:test';
import { diff, stamp } from './diff.ts';
import { createClock } from './hlc.ts';
import { counter, label, project, snapshotOf, task } from './testing.ts';

describe('diff', () => {
	test('sends a new entity with every field and deleted false', () => {
		const after = snapshotOf({ tasks: [task('t', { sourceKey: 'todoist:task:1' })] });
		expect(diff(snapshotOf(), after)).toEqual([
			{
				kind: 'task',
				id: 't',
				fields: {
					deleted: false,
					parentId: null,
					order: 0,
					title: 't',
					notes: '',
					projectId: null,
					labelIds: [],
					due: null,
					recurrence: null,
					priority: 4,
					reminders: [],
					createdAt: 1,
					completedAt: null,
					sourceKey: 'todoist:task:1',
				},
			},
		]);
	});

	test('sends a missing sourceKey as null', () => {
		const [patch] = diff(snapshotOf(), snapshotOf({ projects: [project('p')] }));
		expect(patch?.fields).toEqual({ deleted: false, name: 'p', createdAt: 1, sourceKey: null });
	});

	test('sends only the fields that changed', () => {
		const before = snapshotOf({ tasks: [task('t', { due: { date: '2026-10-10', time: null } })] });
		const after = snapshotOf({ tasks: [task('t', { title: 'Renamed', due: { date: '2026-10-11', time: null } })] });
		expect(diff(before, after)).toEqual([
			{ kind: 'task', id: 't', fields: { title: 'Renamed', due: { date: '2026-10-11', time: null } } },
		]);
	});

	test('compares nested values by content', () => {
		const recurrence = { interval: 1, unit: 'week' as const, days: [1, 3] as const };
		const before = snapshotOf({ tasks: [task('t', { recurrence })] });
		const after = snapshotOf({ tasks: [task('t', { recurrence: { days: [1, 3], unit: 'week', interval: 1 } })] });
		expect(diff(before, after)).toEqual([]);
	});

	test('turns a missing entity into a tombstone', () => {
		const before = snapshotOf({ labels: [label('l')], tasks: [task('t')] });
		expect(diff(before, snapshotOf())).toEqual([
			{ kind: 'label', id: 'l', fields: { deleted: true } },
			{ kind: 'task', id: 't', fields: { deleted: true } },
		]);
	});

	test('sends undo of delete with deleted false and all fields', () => {
		const deleted = snapshotOf();
		const restored = snapshotOf({ tasks: [task('t', { title: 'Back' })] });
		const [patch] = diff(deleted, restored);
		expect(patch?.fields).toMatchObject({ deleted: false, title: 'Back', priority: 4 });
	});

	test('sends undo of a completion as only the fields it restores', () => {
		const done = snapshotOf({ tasks: [task('t', { completedAt: 5 })] });
		const open = snapshotOf({ tasks: [task('t')] });
		expect(diff(done, open)).toEqual([{ kind: 'task', id: 't', fields: { completedAt: null } }]);
	});

	test('diffs the settings record field by field', () => {
		const after = snapshotOf({ settings: { timeZone: 'Europe/Berlin' } });
		expect(diff(snapshotOf(), after)).toEqual([
			{ kind: 'settings', id: 'settings', fields: { timeZone: 'Europe/Berlin' } },
		]);
	});

	test('puts projects and labels before the tasks that use them', () => {
		const after = snapshotOf({
			tasks: [task('t', { projectId: 'p', labelIds: ['l'] })],
			projects: [project('p')],
			labels: [label('l')],
		});
		expect(diff(snapshotOf(), after).map(p => p.kind)).toEqual(['project', 'label', 'task']);
	});
});

describe('stamp', () => {
	test('gives each patch an op id and a rising clock', () => {
		const patches = diff(snapshotOf(), snapshotOf({ labels: [label('a'), label('b')] }));
		const { ops, clock } = stamp(patches, createClock('dev'), 100, counter('op-'));
		expect(ops.map(op => [op.opId, op.hlc])).toEqual([
			['op-1', '100:0:dev'],
			['op-2', '100:1:dev'],
		]);
		expect(clock).toEqual({ wall: 100, counter: 1, node: 'dev' });
	});
});
