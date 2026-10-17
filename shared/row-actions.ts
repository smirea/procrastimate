import type { Task } from './task.ts';

export type RowToggle = 'complete' | 'reopen';

/** Copy as Markdown is always offered, so it has no flag. */
export type RowActions = { toggle: RowToggle | null; postpone: boolean; delete: boolean };

/**
 * What a task row offers on every list and client: Complete or Reopen, Postpone while it is open and not on an event,
 * Delete, and Copy as Markdown. A task the user may only view offers only Copy, and so does a repeating task's past
 * completion in Completed (`rolled`), since the task itself is still open.
 */
export function rowActions(task: Pick<Task, 'completedAt' | 'event'>, readOnly: boolean, rolled = false): RowActions {
	const editable = !readOnly && !rolled;
	const done = task.completedAt !== null;
	return {
		toggle: editable ? (done ? 'reopen' : 'complete') : null,
		postpone: editable && !done && task.event === null,
		delete: editable,
	};
}
