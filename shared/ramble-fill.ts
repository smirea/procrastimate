import type { RambleTask } from './ramble.ts';
import type { NewTask } from './store.ts';
import type { DateKey } from './task.ts';

export type RambleListDefaults = { projectId: string | null; labelId: string | null; today: boolean };

export type SpokenFields = Pick<
	RambleTask,
	'title' | 'due' | 'recurrence' | 'priority' | 'reminders' | 'projectId' | 'labelIds'
>;

/**
 * The task to save for a spoken task. List defaults fill only what the speech left empty: the list's project, its
 * label first, and today's date in Today. Subtasks pass no defaults, since they live in their parent's project.
 * Matches `Ramble.newTask` in Swift.
 */
export function rambleNewTask(task: SpokenFields, defaults: RambleListDefaults | null, today: DateKey): NewTask {
	const labelId = defaults?.labelId;
	return {
		title: task.title.trim(),
		projectId: task.projectId ?? defaults?.projectId ?? null,
		labelIds: labelId && !task.labelIds.includes(labelId) ? [labelId, ...task.labelIds] : [...task.labelIds],
		due: task.due ?? (defaults?.today ? { date: today, time: null } : null),
		recurrence: task.recurrence,
		priority: task.priority,
		reminders: task.reminders,
	};
}
