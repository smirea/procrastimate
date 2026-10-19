import { describe, expect, test } from 'bun:test';
import { guestRefusal, type GuestRows } from './scope.ts';

const rows: GuestRows = [
	{ kind: 'task', entityId: 'editable', role: 'edit' },
	{ kind: 'task', entityId: 'readable', role: 'view' },
	{ kind: 'project', entityId: 'addable', role: 'edit' },
	{ kind: 'project', entityId: 'visible', role: 'view' },
	{ kind: 'section', entityId: 'aisle', role: 'edit' },
	{ kind: 'label', entityId: 'weekend', role: 'edit' },
	{ kind: 'label', entityId: 'seen', role: 'view' },
];
const REFUSED = 'Not editable in this share';
const put = (id: string, values: Record<string, unknown>) => ({
	op: 'put' as const,
	kind: 'task' as const,
	id,
	values,
});
const patch = (id: string, values: Record<string, unknown>) =>
	({ op: 'patch' as const, kind: 'task' as const, id, values }) as const;

describe('guestRefusal', () => {
	test('an existing task needs an edit row for it', () => {
		expect(guestRefusal(rows, patch('editable', { title: 'x' }), 'me')).toBeNull();
		expect(guestRefusal(rows, patch('readable', { title: 'x' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, { op: 'delete', kind: 'task', id: 'editable' }, 'me')).toBeNull();
		expect(guestRefusal(rows, { op: 'delete', kind: 'task', id: 'readable' }, 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, { op: 'delete', kind: 'task', id: 'unknown' }, 'me')).toBe(REFUSED);
	});

	test('a new task needs an edit row for its parent, project, or label', () => {
		expect(guestRefusal(rows, put('new', { parentId: 'editable' }), 'me')).toBeNull();
		expect(guestRefusal(rows, put('new', { parentId: 'readable' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, put('new', { projectId: 'addable' }), 'me')).toBeNull();
		expect(guestRefusal(rows, put('new', { projectId: 'visible' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, put('new', { labelIds: ['weekend'] }), 'me')).toBeNull();
		expect(guestRefusal(rows, put('new', { labelIds: ['seen'] }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, put('new', { title: 'loose' }), 'me')).toBe(REFUSED);
	});

	test('referenced projects, sections, labels, and parents must be among the guest’s rows', () => {
		expect(guestRefusal(rows, patch('editable', { projectId: 'visible' }), 'me')).toBeNull();
		expect(guestRefusal(rows, patch('editable', { projectId: 'hidden' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, patch('editable', { sectionId: 'aisle' }), 'me')).toBeNull();
		expect(guestRefusal(rows, patch('editable', { sectionId: 'hidden' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, patch('editable', { labelIds: ['weekend', 'seen'] }), 'me')).toBeNull();
		expect(guestRefusal(rows, patch('editable', { labelIds: ['weekend', 'hidden'] }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, patch('editable', { parentId: 'readable' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, put('new', { parentId: 'editable', projectId: 'hidden' }), 'me')).toBe(REFUSED);
	});

	test('a guest keeps the owner’s task in its project and under its parent', () => {
		const placed = { projectId: 'addable', parentId: 'editable' };
		const kept = 'A guest cannot take a task out of its project or parent';
		expect(guestRefusal(rows, patch('editable', { projectId: null }), 'me', placed)).toBe(kept);
		expect(guestRefusal(rows, patch('editable', { parentId: null }), 'me', placed)).toBe(kept);
		expect(guestRefusal(rows, put('editable', { projectId: null, parentId: null }), 'me', placed)).toBe(kept);
		expect(guestRefusal(rows, patch('editable', { projectId: null }), 'me', { projectId: null })).toBeNull();
		expect(guestRefusal(rows, patch('editable', { title: 'renamed' }), 'me', placed)).toBeNull();
	});

	test('a task the space holds needs an edit row, whatever the op, and a patch never creates one', () => {
		expect(guestRefusal(rows, patch('unknown', { projectId: 'addable' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, put('unknown', { projectId: 'addable' }), 'me', {})).toBe(REFUSED);
		expect(guestRefusal(rows, put('unknown', { projectId: 'addable' }), 'me')).toBeNull();
		expect(guestRefusal(rows, put('editable', { projectId: 'visible' }), 'me', {})).toBeNull();
	});

	test('a new comment needs an editable task', () => {
		const comment = (values: Record<string, unknown>) => ({
			op: 'put' as const,
			kind: 'comment' as const,
			id: 'c',
			values,
		});
		expect(guestRefusal(rows, comment({ taskId: 'editable', body: 'hi' }), 'me')).toBeNull();
		expect(guestRefusal(rows, comment({ taskId: 'readable', body: 'hi' }), 'me')).toBe(REFUSED);
		expect(guestRefusal(rows, { op: 'patch', kind: 'comment', id: 'c', values: { body: 'x' } }, 'me')).toBe(REFUSED);
	});

	test('only the author edits or deletes a comment, and it stays on an editable task', () => {
		const mine = { taskId: 'editable', authorId: 'me' };
		const theirs = { taskId: 'editable', authorId: 'owner' };
		const edit = { op: 'patch' as const, kind: 'comment' as const, id: 'c', values: { body: 'x' } };
		const remove = { op: 'delete' as const, kind: 'comment' as const, id: 'c' };
		expect(guestRefusal(rows, edit, 'me', mine)).toBeNull();
		expect(guestRefusal(rows, remove, 'me', mine)).toBeNull();
		expect(guestRefusal(rows, edit, 'me', theirs)).toBe('Only the author can edit a comment');
		expect(guestRefusal(rows, remove, 'me', theirs)).toBe('Only the author can delete a comment');
		expect(guestRefusal(rows, edit, 'me', { taskId: 'readable', authorId: 'me' })).toBe(REFUSED);
		expect(guestRefusal(rows, { ...edit, values: { taskId: 'readable' } }, 'me', mine)).toBe(REFUSED);
		expect(guestRefusal(rows, { ...edit, values: { taskId: 'editable' } }, 'me', mine)).toBeNull();
	});

	test('projects, sections, labels, read markers, and settings are never a guest’s to write', () => {
		for (const kind of ['project', 'section', 'label', 'read', 'settings'] as const) {
			expect(guestRefusal(rows, { op: 'put', kind, id: 'x', values: {} }, 'me')).toBe(REFUSED);
		}
	});
});
