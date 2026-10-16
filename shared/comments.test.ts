import { expect } from 'bun:test';
import * as rules from './comments.ts';
import type { StoreData } from './store.ts';
import type { Comment } from './sync/protocol.ts';
import { describe, recorded, test } from './vectors/record.ts';

const addComment = recorded('comments', rules.addComment);
const commentBadges = recorded('comments', rules.commentBadges);
const commentsOn = recorded('comments', rules.commentsOn);
const deleteComment = recorded('comments', rules.deleteComment);
const editComment = recorded('comments', rules.editComment);
const markRead = recorded('comments', rules.markRead);

const comment = (id: string, taskId: string, authorId: string | null, createdAt: number): Comment => ({
	id,
	taskId,
	body: id,
	authorId,
	createdAt,
	editedAt: null,
});

const data = (fields: Partial<StoreData> = {}): StoreData => ({
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	comments: [],
	reads: [],
	...fields,
});

describe('comments', () => {
	test('a task lists only its own comments, oldest first', () => {
		const list = [comment('late', 't', 'ann', 30), comment('other', 'u', 'ann', 10), comment('early', 't', 'bob', 20)];
		expect(commentsOn(list, 't').map(c => c.id)).toEqual(['early', 'late']);
	});

	test('a blank comment is not added, and a body is trimmed', () => {
		expect(addComment(data(), 't', '  \n ', 'ann', { id: 'c', now: 5 })).toEqual({ data: data(), comment: null });
		const { data: next, comment: added } = addComment(data(), 't', '  Buy the blue one ', 'ann', { id: 'c', now: 5 });
		expect(added).toEqual({
			id: 'c',
			taskId: 't',
			body: 'Buy the blue one',
			authorId: 'ann',
			createdAt: 5,
			editedAt: null,
		});
		expect(next.comments).toEqual([added!]);
	});

	test('only the author edits or deletes a comment', () => {
		const start = data({ comments: [comment('c', 't', 'ann', 1)] });
		expect(editComment(start, 'c', 'Changed', 'bob', 9)).toBe(start);
		expect(editComment(start, 'c', '   ', 'ann', 9)).toBe(start);
		expect(editComment(start, 'c', 'Changed ', 'ann', 9).comments).toEqual([
			{ id: 'c', taskId: 't', body: 'Changed', authorId: 'ann', createdAt: 1, editedAt: 9 },
		]);
		expect(deleteComment(start, 'c', 'bob')).toBe(start);
		expect(deleteComment(start, 'c', 'ann').comments).toEqual([]);
	});

	test('a badge counts every comment and the unread ones someone else wrote after the marker', () => {
		const list = [
			comment('mine', 't', 'ann', 50),
			comment('pending', 't', null, 60),
			comment('seen', 't', 'bob', 10),
			comment('new', 't', 'bob', 40),
			comment('elsewhere', 'u', 'bob', 5),
		];
		expect(commentBadges(list, [{ id: 't', readAt: 20 }], 'ann')).toEqual({
			t: { count: 4, unread: 1 },
			u: { count: 1, unread: 1 },
		});
	});

	test('reading moves the marker to the newest comment by someone else, never back, and not without news', () => {
		const list = [comment('theirs', 't', 'bob', 40), comment('mine', 't', 'ann', 90)];
		const read = markRead(data(), 't', list, 'ann', 100);
		expect(read.reads).toEqual([{ id: 't', readAt: 100 }]);
		expect(markRead(read, 't', list, 'ann', 200)).toBe(read);
		const ahead = markRead(read, 't', [...list, comment('skewed', 't', 'bob', 500)], 'ann', 300);
		expect(ahead.reads).toEqual([{ id: 't', readAt: 500 }]);
		const solo = data();
		expect(markRead(solo, 't', [comment('mine', 't', 'ann', 1)], 'ann', 10)).toBe(solo);
	});
});
