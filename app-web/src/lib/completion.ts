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
			toasts.show(`Completed “${title}”`, { label: 'Undo', run: () => store.restoreCompletion(completion.previous) });
			return;
		case 'rolled':
			toasts.show(`Completed “${title}”, next due ${formatDue(completion.next, clock.today)}`, {
				label: 'Undo',
				run: () => store.restoreCompletion(completion.previous),
			});
			return;
		default: {
			const never: never = completion;
			return never;
		}
	}
}
