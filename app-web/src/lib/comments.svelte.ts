import { commentBadges, type CommentBadge } from 'shared/comments.ts';
import { session } from './session.svelte.ts';
import { store } from './store.svelte.ts';

/** Every row's comment badge from one pass over the comments, which the store cannot do itself without the session. */
class Comments {
	#badges = $derived(commentBadges(store.comments, store.own.reads, session.userId));

	badge(taskId: string): CommentBadge | undefined {
		return this.#badges[taskId];
	}
}

export const comments = new Comments();
