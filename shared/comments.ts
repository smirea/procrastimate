import { z } from 'zod';
import type { Creation, StoreData } from './store.ts';
import type { Comment, CommentRead } from './sync/protocol.ts';
import { byCreation } from './sync/snapshot.ts';

/**
 * Comments on tasks and who has read them, as pure rules both clients share. A comment lives in its task's space; a
 * read marker lives in the reader's own space, keyed by the task id. See `docs/decisions/comments.md`.
 */

export const commentBadgeSchema = z
	.object({ count: z.number().int().nonnegative(), unread: z.number().int().nonnegative() })
	.meta({ id: 'CommentBadge', description: 'How many comments a task has, and how many someone else wrote unread.' });
export type CommentBadge = z.infer<typeof commentBadgeSchema>;

/** One task's comments, oldest first. */
export function commentsOn(comments: readonly Comment[], taskId: string): Comment[] {
	return comments.filter(comment => comment.taskId === taskId).toSorted(byCreation);
}

/**
 * Each commented task's badge, by task id. A comment is unread when someone other than `me` wrote it after the
 * reader's marker for its task. A comment still waiting for the server's author stamp is the reader's own.
 */
export function commentBadges(
	comments: readonly Comment[],
	reads: readonly CommentRead[],
	me: string | null,
): Record<string, CommentBadge> {
	const readAt = new Map(reads.map(read => [read.id, read.readAt]));
	const badges: Record<string, CommentBadge> = {};
	for (const comment of comments) {
		const badge = (badges[comment.taskId] ??= { count: 0, unread: 0 });
		badge.count++;
		const theirs = comment.authorId !== null && comment.authorId !== me;
		if (theirs && comment.createdAt > (readAt.get(comment.taskId) ?? 0)) badge.unread++;
	}
	return badges;
}

/** Adds a comment by `authorId`, or returns the data unchanged with no comment when the body is blank. */
export function addComment(
	data: StoreData,
	taskId: string,
	body: string,
	authorId: string,
	{ id, now }: Creation,
): { data: StoreData; comment: Comment | null } {
	const text = body.trim();
	if (!text) return { data, comment: null };
	const comment: Comment = { id, taskId, body: text, authorId, createdAt: now, editedAt: null };
	return { data: { ...data, comments: [...data.comments, comment] }, comment };
}

/** Rewrites `me`'s own comment. A blank or unchanged body, or someone else's comment, leaves the data as it was. */
export function editComment(data: StoreData, id: string, body: string, me: string, now: number): StoreData {
	const text = body.trim();
	const index = data.comments.findIndex(comment => comment.id === id);
	const comment = data.comments[index];
	if (!comment || comment.authorId !== me || !text || text === comment.body) return data;
	return { ...data, comments: data.comments.with(index, { ...comment, body: text, editedAt: now }) };
}

/** Deletes `me`'s own comment. Someone else's stays. */
export function deleteComment(data: StoreData, id: string, me: string): StoreData {
	const comment = data.comments.find(c => c.id === id);
	if (!comment || comment.authorId !== me) return data;
	return { ...data, comments: data.comments.filter(c => c.id !== id) };
}

/**
 * Marks a task's comments read in `me`'s own data. `comments` come from whatever space holds the task. The marker
 * never moves back, and it covers the newest comment even when that comment's clock ran ahead of `now`. Nothing
 * changes when nobody else wrote since the marker, so opening a task does not write on every visit.
 */
export function markRead(
	own: StoreData,
	taskId: string,
	comments: readonly Comment[],
	me: string,
	now: number,
): StoreData {
	const theirs = comments.filter(c => c.taskId === taskId && c.authorId !== null && c.authorId !== me);
	const newest = Math.max(0, ...theirs.map(c => c.createdAt));
	const index = own.reads.findIndex(read => read.id === taskId);
	const readAt = own.reads[index]?.readAt ?? 0;
	if (newest <= readAt) return own;
	const read: CommentRead = { id: taskId, readAt: Math.max(now, newest) };
	return { ...own, reads: index === -1 ? [...own.reads, read] : own.reads.with(index, read) };
}
