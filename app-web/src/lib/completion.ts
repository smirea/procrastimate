import { completedToast, formatDate } from 'shared/format.ts';
import type { DateKey, Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { clock, toasts } from './ui.svelte.ts';

export function completeTask(task: Task) {
	const completion = store.completeTask(task.id, clock.today);
	if (!completion) return;
	const next = completion.kind === 'rolled' ? completion.next : null;
	toasts.show(completedToast(task.title, next, clock.today), {
		label: 'Undo',
		run: () => store.restoreCompletion(completion.previous),
	});
}

/** Keeps the time of day, and leaves the repeat to count from the new date. */
export function postponeTask(task: Task, date: DateKey) {
	const previous = task.due;
	store.updateTask(task.id, { due: { date, time: task.due?.time ?? null } });
	toasts.show(`Moved “${task.title}” to ${formatDate(date, clock.today)}`, {
		label: 'Undo',
		run: () => store.updateTask(task.id, { due: previous }),
	});
}
