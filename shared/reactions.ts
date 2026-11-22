import { z } from 'zod';
import type { StoreData } from './store.ts';
import type { Reaction } from './model.ts';

/**
 * Emoji reactions on tasks, as pure rules both clients share. A reaction lives in its task's space, and each person
 * has at most one per task, so its row id is `<task>:<author>`. See `docs/decisions/comments.md`.
 */

export const REACTIONS = ['👍', '👎', '👀', '🛑', '❓'] as const;
export const reactionEmojiSchema = z
	.enum(REACTIONS)
	.meta({ id: 'ReactionEmoji', 'x-enum-names': ['thumbsUp', 'thumbsDown', 'eyes', 'stop', 'question'] });
export type ReactionEmoji = z.infer<typeof reactionEmojiSchema>;

export const reactionGroupSchema = z
	.object({ emoji: reactionEmojiSchema, authorIds: z.array(z.string()) })
	.meta({ id: 'ReactionGroup', description: 'One emoji on a task and who reacted with it, oldest first.' });
export type ReactionGroup = z.infer<typeof reactionGroupSchema>;

export const reactionIdOf = (taskId: string, authorId: string) => `${taskId}:${authorId}`;

/** Each reacted task's groups, by task id, in the picker's order. */
export function reactionGroups(reactions: readonly Reaction[]): Record<string, ReactionGroup[]> {
	const byTask: Record<string, Map<ReactionEmoji, Reaction[]>> = {};
	for (const reaction of reactions) {
		const groups = (byTask[reaction.taskId] ??= new Map());
		groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction]);
	}
	const result: Record<string, ReactionGroup[]> = {};
	for (const [taskId, groups] of Object.entries(byTask)) {
		result[taskId] = REACTIONS.flatMap(emoji => {
			const list = groups.get(emoji);
			if (!list) return [];
			const authorIds = list.toSorted((a, b) => a.createdAt - b.createdAt).map(reaction => reaction.authorId);
			return [{ emoji, authorIds }];
		});
	}
	return result;
}

/** `me`'s reaction on a task, if any. */
export function reactionOf(reactions: readonly Reaction[], taskId: string, me: string): Reaction | undefined {
	return reactions.find(reaction => reaction.id === reactionIdOf(taskId, me));
}

/**
 * Reacts to a task as `me`. Each person has one reaction per task: another emoji replaces theirs, and the same one
 * takes it back.
 */
export function react(data: StoreData, taskId: string, emoji: ReactionEmoji, me: string, now: number): StoreData {
	const id = reactionIdOf(taskId, me);
	const index = data.reactions.findIndex(reaction => reaction.id === id);
	const current = data.reactions[index];
	if (current?.emoji === emoji) return { ...data, reactions: data.reactions.filter(reaction => reaction.id !== id) };
	if (current) return { ...data, reactions: data.reactions.with(index, { ...current, emoji, createdAt: now }) };
	return { ...data, reactions: [...data.reactions, { id, taskId, emoji, authorId: me, createdAt: now }] };
}
