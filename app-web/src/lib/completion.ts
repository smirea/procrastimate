import { completedToast } from 'shared/format.ts';
import type { Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { clock, toasts } from './ui.svelte.ts';

/** Completes a task, or moves a recurring one to its next occurrence, with an undo toast either way. */
export function completeTask(task: Task) {
	const completion = store.completeTask(task.id, clock.today);
	if (!completion) return;
	const next = completion.kind === 'rolled' ? completion.next : null;
	toasts.show(completedToast(task.title, next, clock.today), {
		label: 'Undo',
		run: () => store.restoreCompletion(completion.previous),
	});
}
