import type { RambleTask } from './ramble.ts';
import type { NewTask } from './store.ts';
import type { ListDefaults } from './screens.ts';

export type SpokenFields = Pick<
	RambleTask,
	'title' | 'due' | 'recurrence' | 'priority' | 'reminders' | 'projectId' | 'labelIds'
>;

/**
 * The task to save for a spoken task. List defaults fill only what the speech left empty, as in quick add: the
 * list's project, and its section while the speech names no other project, its label first, its place, and the day
 * of an Inbox heading. The list's event stands in for any spoken date or repeat, as a picked event does in quick add.
 * Subtasks pass no defaults, since they live in their parent's project. Matches `Ramble.newTask` in Swift.
 */
export function rambleNewTask(task: SpokenFields, defaults: ListDefaults | null): NewTask {
	const labelId = defaults?.labelId;
	const event = defaults?.event ?? null;
	const ownProject = task.projectId === null || task.projectId === defaults?.projectId;
	return {
		title: task.title.trim(),
		projectId: task.projectId ?? defaults?.projectId ?? null,
		sectionId: ownProject ? (defaults?.sectionId ?? null) : null,
		labelIds: labelId && !task.labelIds.includes(labelId) ? [labelId, ...task.labelIds] : [...task.labelIds],
		due: event ? null : (task.due ?? (defaults?.date ? { date: defaults.date, time: null } : null)),
		recurrence: event ? null : task.recurrence,
		priority: task.priority,
		reminders: task.reminders,
		location: defaults?.location ?? null,
		event,
	};
}
