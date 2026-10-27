import { completedToast, formatDate, reopenedToast } from 'shared/format.ts';
import type { Deleted, Undo } from 'shared/store.ts';
import type { DateKey, Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { clock, toasts } from './ui.svelte.ts';

/** The store holds the undo while the toast shows, so stacked undos give the same result in any order. */
export function toastUndo(message: string, undo: Undo) {
	const id = store.offerUndo(undo);
	toasts.show(message, { label: 'Undo', run: () => store.undo(id), dismissed: () => store.dropUndo(id) });
}

export function completeTask(task: Task) {
	const completion = store.completeTask(task.id, clock.today);
	if (!completion) return;
	const next = completion.kind === 'rolled' ? completion.next : null;
	toastUndo(completedToast(task.title, next, clock.today), { kind: 'completion', previous: completion.previous });
}

/**
 * Reopening a subtask reopens its completed ancestors too, so undo puts back each one's `completedAt`. Undo writes
 * back only that, so an edit made in between survives it.
 */
export function reopenTask(task: Task) {
	const reopened = store.reopenTask(task.id);
	if (reopened.length) toastUndo(reopenedToast(task.title), { kind: 'reopen', reopened });
}

/** Keeps the time of day, and leaves the repeat to count from the new date. */
export function postponeTask(task: Task, date: DateKey) {
	store.updateTask(task.id, { due: { date, time: task.due?.time ?? null } });
	toastUndo(`Moved “${task.title}” to ${formatDate(date, clock.today)}`, {
		kind: 'postpone',
		id: task.id,
		due: task.due,
	});
}

/** Deleting a project, section, or label offers undo, which brings back its tasks and label assignments as they were. */
export function toastDeleted(name: string, deleted: Deleted | undefined) {
	if (deleted) toastUndo(`Deleted “${name}”`, { kind: 'delete', deleted });
}

/** Deletes the task with its subtasks. Undo puts every one of them back. */
export function deleteTask(task: Task) {
	const tasks = store.deleteTask(task.id);
	if (!tasks.length) return;
	toastUndo(`Deleted “${task.title}”`, {
		kind: 'delete',
		deleted: { projects: [], sections: [], labels: [], tasks, labelings: [] },
	});
}
