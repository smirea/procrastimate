import type { Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { clock, toasts } from './ui.svelte.ts';
import { formatDue } from './format.ts';

/** Completes a task, or moves a recurring one to its next occurrence, with an undo toast either way. */
export function completeTask(task: Task) {
	const { id, title } = task;
	const completion = store.completeTask(id, clock.today);
	switch (completion?.kind) {
		case undefined:
			return;
		case 'done':
			toasts.show(`Completed “${title}”`, { label: 'Undo', run: () => store.reopenTask(id) });
			return;
		case 'rolled': {
			const { next, previous } = completion;
			toasts.show(`Completed “${title}”, next due ${formatDue(next, clock.today)}`, {
				label: 'Undo',
				run: () => store.updateTask(id, previous),
			});
			return;
		}
		default: {
			const never: never = completion;
			return never;
		}
	}
}
