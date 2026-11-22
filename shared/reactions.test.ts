import { expect } from 'bun:test';
import * as rules from './reactions.ts';
import type { StoreData } from './store.ts';
import type { Reaction } from './model.ts';
import { describe, recorded, test } from './vectors/record.ts';

const react = recorded('reactions', rules.react);
const reactionGroups = recorded('reactions', rules.reactionGroups);

const reaction = (taskId: string, authorId: string, emoji: rules.ReactionEmoji, createdAt: number): Reaction => ({
	id: rules.reactionIdOf(taskId, authorId),
	taskId,
	emoji,
	authorId,
	createdAt,
});

const data = (reactions: Reaction[] = []): StoreData => ({
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	comments: [],
	reactions,
	reads: [],
});

describe('reactions', () => {
	test('each person has one reaction per task: another emoji replaces it, and the same one takes it back', () => {
		const first = react(data(), 't', '👍', 'ann', 1);
		expect(first.reactions).toEqual([reaction('t', 'ann', '👍', 1)]);
		const replaced = react(first, 't', '👀', 'ann', 2);
		expect(replaced.reactions).toEqual([reaction('t', 'ann', '👀', 2)]);
		expect(react(replaced, 't', '👀', 'ann', 3).reactions).toEqual([]);
		expect(react(replaced, 't', '👀', 'bob', 3).reactions).toEqual([
			reaction('t', 'ann', '👀', 2),
			reaction('t', 'bob', '👀', 3),
		]);
	});

	test('a task groups its reactions in the picker order, with who reacted oldest first', () => {
		const groups = reactionGroups([
			reaction('t', 'cat', '❓', 4),
			reaction('t', 'bob', '👍', 3),
			reaction('u', 'ann', '👎', 1),
			reaction('t', 'ann', '👍', 2),
		]);
		expect(groups).toEqual({
			t: [
				{ emoji: '👍', authorIds: ['ann', 'bob'] },
				{ emoji: '❓', authorIds: ['cat'] },
			],
			u: [{ emoji: '👎', authorIds: ['ann'] }],
		});
	});
});
