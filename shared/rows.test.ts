import { expect } from 'bun:test';
import * as rows from './rows.ts';
import { label, project, snapshotOf, task } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const rowWrites = recorded('rows', rows.rowWrites);
const coalesce = recorded('rows', rows.coalesce);
const rejectionNotice = recorded('rows', rows.rejectionNotice);

describe('rowWrites', () => {
	test('puts a new entity with every field', () => {
		const after = snapshotOf({ tasks: [task('t', { sourceKey: 'todoist:task:1' })] });
		expect(rowWrites(snapshotOf(), after)).toEqual([
			{
				op: 'put',
				kind: 'task',
				id: 't',
				values: {
					parentId: null,
					order: 0,
					title: 't',
					notes: '',
					projectId: null,
					sectionId: null,
					labelIds: [],
					due: null,
					recurrence: null,
					priority: 4,
					reminders: [],
					location: null,
					event: null,
					images: [],
					createdAt: 1,
					completedAt: null,
					createdBy: null,
					completedBy: null,
					lastCompletedAt: null,
					sourceKey: 'todoist:task:1',
				},
			},
		]);
	});

	test('writes a missing sourceKey as null', () => {
		const [write] = rowWrites(snapshotOf(), snapshotOf({ projects: [project('p')] }));
		expect(write?.values).toEqual({ name: 'p', order: 0, createdAt: 1, sourceKey: null });
	});

	test('patches only the fields that changed', () => {
		const before = snapshotOf({ tasks: [task('t', { due: { date: '2026-10-10', time: null } })] });
		const after = snapshotOf({ tasks: [task('t', { title: 'Renamed', due: { date: '2026-10-11', time: null } })] });
		expect(rowWrites(before, after)).toEqual([
			{ op: 'patch', kind: 'task', id: 't', values: { title: 'Renamed', due: { date: '2026-10-11', time: null } } },
		]);
	});

	test('compares nested values by content', () => {
		const recurrence = { interval: 1, unit: 'week' as const, days: [1, 3] as const };
		const before = snapshotOf({ tasks: [task('t', { recurrence })] });
		const after = snapshotOf({ tasks: [task('t', { recurrence: { days: [1, 3], unit: 'week', interval: 1 } })] });
		expect(rowWrites(before, after)).toEqual([]);
	});

	test('deletes a missing entity', () => {
		const before = snapshotOf({ labels: [label('l')], tasks: [task('t')] });
		expect(rowWrites(before, snapshotOf())).toEqual([
			{ op: 'delete', kind: 'label', id: 'l' },
			{ op: 'delete', kind: 'task', id: 't' },
		]);
	});

	test('puts a restored entity again with every field', () => {
		const [write] = rowWrites(snapshotOf(), snapshotOf({ tasks: [task('t', { title: 'Back' })] }));
		expect(write).toMatchObject({ op: 'put', values: { title: 'Back', priority: 4 } });
	});

	test('undoing a completion patches only what it restores', () => {
		const done = snapshotOf({ tasks: [task('t', { completedAt: 5 })] });
		expect(rowWrites(done, snapshotOf({ tasks: [task('t')] }))).toEqual([
			{ op: 'patch', kind: 'task', id: 't', values: { completedAt: null } },
		]);
	});

	test('patches the settings record field by field', () => {
		const after = snapshotOf({ settings: { timeZone: 'Europe/Berlin' } });
		expect(rowWrites(snapshotOf(), after)).toEqual([
			{ op: 'patch', kind: 'settings', id: 'settings', values: { timeZone: 'Europe/Berlin' } },
		]);
	});

	test('puts projects and labels before the tasks that use them', () => {
		const after = snapshotOf({
			tasks: [task('t', { projectId: 'p', labelIds: ['l'] })],
			projects: [project('p')],
			labels: [label('l')],
		});
		expect(rowWrites(snapshotOf(), after).map(write => write.kind)).toEqual(['project', 'label', 'task']);
	});
});

describe('coalesce', () => {
	test('keystrokes in a title fold into one patch with the last value', () => {
		const writes = ['H', 'He', 'Hello'].map(title => ({
			op: 'patch' as const,
			kind: 'task' as const,
			id: 't',
			values: { title },
		}));
		expect(coalesce(writes)).toEqual([{ op: 'patch', kind: 'task', id: 't', values: { title: 'Hello' } }]);
	});

	test('a patch folds into the put before it', () => {
		expect(
			coalesce([
				{ op: 'put', kind: 'task', id: 't', values: { title: '', notes: '' } },
				{ op: 'patch', kind: 'task', id: 't', values: { title: 'Milk' } },
			]),
		).toEqual([{ op: 'put', kind: 'task', id: 't', values: { title: 'Milk', notes: '' } }]);
	});

	test('a delete replaces earlier writes and a patch after it changes nothing', () => {
		expect(
			coalesce([
				{ op: 'patch', kind: 'task', id: 't', values: { title: 'Milk' } },
				{ op: 'delete', kind: 'task', id: 't' },
				{ op: 'patch', kind: 'task', id: 't', values: { title: 'Late' } },
			]),
		).toEqual([{ op: 'delete', kind: 'task', id: 't' }]);
	});

	test('a row deleted and put again moves after the rows it points at', () => {
		expect(
			coalesce([
				{ op: 'delete', kind: 'task', id: 't' },
				{ op: 'put', kind: 'project', id: 'p', values: { name: 'Home' } },
				{ op: 'put', kind: 'task', id: 't', values: { projectId: 'p' } },
			]),
		).toEqual([
			{ op: 'put', kind: 'project', id: 'p', values: { name: 'Home' } },
			{ op: 'put', kind: 'task', id: 't', values: { projectId: 'p' } },
		]);
	});

	test('writes to other rows keep their order', () => {
		const writes: rows.RowWrite[] = [
			{ op: 'patch' as const, kind: 'task' as const, id: 'a', values: { title: 'A' } },
			{ op: 'patch' as const, kind: 'task' as const, id: 'b', values: { title: 'B' } },
			{ op: 'patch' as const, kind: 'task' as const, id: 'a', values: { notes: 'n' } },
		];
		expect(coalesce(writes)).toEqual([
			{ op: 'patch', kind: 'task', id: 'a', values: { title: 'A', notes: 'n' } },
			{ op: 'patch', kind: 'task', id: 'b', values: { title: 'B' } },
		]);
	});
});

describe('rejectionNotice', () => {
	test('names the one row it refused, or counts them', () => {
		const local = snapshotOf({ tasks: [task('t', { title: 'Milk' })], projects: [project('p', { name: 'Home' })] });
		expect(rejectionNotice(local, [])).toBeNull();
		expect(rejectionNotice(local, [{ kind: 'project', id: 'p' }])).toBe('Couldn’t save a change to “Home”');
		expect(rejectionNotice(local, [{ kind: 'comment', id: 'c' }])).toBe('Couldn’t save a change');
		expect(
			rejectionNotice(local, [
				{ kind: 'task', id: 't' },
				{ kind: 'task', id: 't' },
			]),
		).toBe('Couldn’t save a change to “Milk”');
		expect(
			rejectionNotice(local, [
				{ kind: 'task', id: 't' },
				{ kind: 'project', id: 'p' },
				{ kind: 'comment', id: 'c' },
			]),
		).toBe('Couldn’t save changes to 3 items');
	});
});
