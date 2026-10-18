import { completedToast, formatDate, reopenedToast } from 'shared/format.ts';
import { ancestorsOf } from 'shared/subtasks.ts';
import type { Deleted } from 'shared/store.ts';
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

/**
 * Reopening a subtask reopens its completed ancestors too, so undo puts back each one's `completedAt`. Undo reads the
 * other fields when it runs, so an edit made in between survives it.
 */
export function reopenTask(task: Task) {
	const reopened = [task, ...ancestorsOf(store.tasks, task.id)].filter(t => t.completedAt !== null);
	store.reopenTask(task.id);
	toasts.show(reopenedToast(task.title), {
		label: 'Undo',
		run: () =>
			store.restoreCompletion(
				reopened.flatMap(({ id, completedAt }) => {
					const current = store.task(id);
					if (!current) return [];
					const { lastCompletedAt, due, reminders, event } = current;
					return [{ id, completedAt, lastCompletedAt, due, reminders, event }];
				}),
			),
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

/** Deleting a project, section, or label offers undo, which brings back its tasks and label assignments as they were. */
export function toastDeleted(name: string, deleted: Deleted | undefined) {
	if (!deleted) return;
	toasts.show(`Deleted “${name}”`, { label: 'Undo', run: () => store.undelete(deleted) });
}

/** Deletes the task with its subtasks. Undo puts every one of them back. */
export function deleteTask(task: Task) {
	const removed = store.deleteTask(task.id);
	if (!removed.length) return;
	toasts.show(`Deleted “${task.title}”`, { label: 'Undo', run: () => store.undeleteTasks(removed) });
}
