import { expect } from 'bun:test';
import * as local from './local-rows.ts';
import { DEFAULT_SETTINGS } from './model.ts';
import { label, project, section, task } from './testing.ts';
import { describe, recorded, test } from './vectors/record.ts';

const replayReads = recorded('local-rows', local.replayReads);

const row = <T extends { id: string }>(userId: string, entity: T) => ({ ...entity, userId, sourceKey: null });
const KINDS = ['task', 'project', 'section', 'label', 'comment', 'read', 'settings', 'access'] as const;
const everything = (fields: Partial<Record<(typeof KINDS)[number], unknown[]>>) =>
	Object.fromEntries(KINDS.map(kind => [kind, { ids: 'all', rows: fields[kind] ?? [] }])) as local.RowsRead;
const changed = <R extends { id: string }>(ids: string[], rows: R[]) => ({ ids, rows });
const view = (id: string, owner = 'ann') =>
	({ id: `me:task:${id}`, grantee: 'me', owner, kind: 'task', entityId: id, role: 'view' }) as const;
const empty = { tasks: [], projects: [], sections: [], labels: [], comments: [], reads: [] };

describe('LocalRows', () => {
	test('splits rows by owner and sorts them by creation, keeping read markers only for the user', () => {
		const [after] = replayReads('me', [
			everything({
				task: [
					row('me', task('later', { createdAt: 9 })),
					row('ann', task('hers', { createdAt: 2 })),
					row('me', task('first', { createdAt: 1 })),
				],
				project: [row('ann', project('groceries'))],
				read: [row('me', { id: 'hers', readAt: 4 }), row('ann', { id: 'theirs', readAt: 5 })],
				access: [view('hers')],
			}),
		]);
		expect(after!.touched).toEqual(['ann', 'me']);
		expect(after!.own.tasks.map(t => t.id)).toEqual(['first', 'later']);
		expect(after!.own.tasks[0]).toEqual(task('first', { createdAt: 1 }));
		expect(after!.own.reads).toEqual([{ id: 'hers', readAt: 4 }]);
		expect(after!.settings).toBeNull();
		expect(after!.spaces.ann!.data.tasks.map(t => t.id)).toEqual(['hers']);
		expect(after!.spaces.ann!.data.projects.map(p => p.id)).toEqual(['groceries']);
		expect(after!.spaces.ann!.data.reads).toEqual([]);
		expect(after!.spaces.ann!.access).toEqual([view('hers')]);
	});

	test('reads the own settings row, and drops a row that does not parse instead of the load', () => {
		const [after] = replayReads('me', [
			everything({
				task: [row('me', task('kept')), row('me', { ...task('broken'), priority: 'urgent' })],
				settings: [{ userId: 'me', id: 'settings', ...DEFAULT_SETTINGS, dictation: 'elevenlabs' }],
			}),
		]);
		expect(after!.own.tasks.map(t => t.id)).toEqual(['kept']);
		expect(after!.settings).toEqual({ ...DEFAULT_SETTINGS, dictation: 'elevenlabs' });
	});

	test('an owner who shares nothing visible yet still has a space', () => {
		const [after] = replayReads('me', [
			everything({
				access: [{ id: 'me:project:p', grantee: 'me', owner: 'ann', kind: 'project', entityId: 'p', role: 'edit' }],
			}),
		]);
		expect(after!.spaces.ann!.data).toEqual(empty);
	});

	test('a later read changes only the rows it names and reports only their owners', () => {
		const [, after] = replayReads('me', [
			everything({
				task: [row('me', task('mine', { title: 'Old' })), row('me', task('other')), row('ann', task('hers'))],
				access: [view('hers')],
			}),
			{ task: changed(['mine'], [row('me', task('mine', { title: 'New' }))]) },
		]);
		expect(after!.touched).toEqual(['me']);
		expect(after!.own.tasks.map(t => [t.id, t.title])).toEqual([
			['mine', 'New'],
			['other', 'other'],
		]);
		expect(after!.spaces.ann!.data.tasks.map(t => t.id)).toEqual(['hers']);
	});

	test('a row that is gone leaves, and a space goes once nothing of it reaches this user', () => {
		const [, mineGone, hersGone] = replayReads('me', [
			everything({ task: [row('me', task('mine')), row('ann', task('hers'))], access: [view('hers')] }),
			{ task: changed(['mine'], []) },
			{ task: changed(['hers'], []), access: changed([view('hers').id], []) },
		]);
		expect(mineGone!.touched).toEqual(['me']);
		expect(mineGone!.own.tasks).toEqual([]);
		expect(hersGone!.touched).toEqual(['ann']);
		expect(hersGone!.spaces).toEqual({});
	});

	test('a deleted project reads as Inbox until it comes back, and then holds its tasks again', () => {
		const [, deleted, restored] = replayReads('me', [
			everything({
				project: [row('me', project('work'))],
				section: [row('me', section('later', 'work'))],
				task: [row('me', task('report', { projectId: 'work', sectionId: 'later' }))],
			}),
			{ project: changed(['work'], []) },
			{ project: changed(['work'], [row('me', project('work'))]) },
		]);
		expect(deleted!.own.tasks.map(t => [t.projectId, t.sectionId])).toEqual([[null, null]]);
		expect(deleted!.own.sections).toEqual([]);
		expect(restored!.own.tasks.map(t => [t.projectId, t.sectionId])).toEqual([['work', 'later']]);
		expect(restored!.own.sections.map(s => s.id)).toEqual(['later']);
	});

	test('reading everything again drops what the database no longer holds', () => {
		const [, after] = replayReads('me', [
			everything({
				task: [row('me', task('mine')), row('ann', task('hers'))],
				access: [view('hers')],
				label: [row('me', label('home'))],
			}),
			everything({ task: [row('me', task('fresh'))] }),
		]);
		expect(after!.touched).toEqual(['ann', 'me']);
		expect(after!.own.tasks.map(t => t.id)).toEqual(['fresh']);
		expect(after!.own.labels).toEqual([]);
		expect(after!.spaces).toEqual({});
	});
});
