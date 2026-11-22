import { reactionGroups, type ReactionGroup } from 'shared/reactions.ts';
import { store } from './store.svelte.ts';

/** Every row's reactions from one pass over them. */
class Reactions {
	#groups = $derived(reactionGroups(store.reactions));

	of(taskId: string): ReactionGroup[] | undefined {
		return this.#groups[taskId];
	}
}

export const reactions = new Reactions();
