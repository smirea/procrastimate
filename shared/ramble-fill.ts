import type { RambleDraft } from './ramble.ts';
import type { DateKey, Due, Priority, Recurrence, Reminder } from './task.ts';

/** What one ramble writes into quick add: the title in the textbox, and the chips beside it. */
export type RambleQuickAdd = {
	text: string;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
	projectId: string | null;
	labelIds: string[];
};

/**
 * The grammar's tasks as one quick-add field. One task keeps its title and metadata. Several tasks become one
 * title, in order, and leave the chips empty: quick add holds a single task, so their dates are not split apart.
 * Notes and subtasks stay out of the field.
 */
export function quickAddFromRamble(draft: RambleDraft): RambleQuickAdd | null {
	const tasks = draft.tasks.filter(task => task.title.trim());
	const first = tasks[0];
	if (!first) return null;
	if (tasks.length > 1) {
		return {
			text: tasks.map(task => task.title.trim()).join('. '),
			due: null,
			recurrence: null,
			priority: null,
			reminders: [],
			projectId: null,
			labelIds: [],
		};
	}
	return {
		text: first.title.trim(),
		due: first.due,
		recurrence: first.recurrence,
		priority: first.priority,
		reminders: first.reminders,
		projectId: first.projectId,
		labelIds: [...first.labelIds],
	};
}

/** List defaults fill only the fields the speech left empty. A spoken value replaces the list's. */
export function withListDefaults(
	fill: RambleQuickAdd,
	defaults: { projectId: string | null; labelId: string | null; today: boolean },
	today: DateKey,
): RambleQuickAdd {
	const labelIds =
		defaults.labelId && !fill.labelIds.includes(defaults.labelId) ? [defaults.labelId, ...fill.labelIds] : fill.labelIds;
	return {
		...fill,
		due: fill.due ?? (defaults.today ? { date: today, time: null } : null),
		projectId: fill.projectId ?? defaults.projectId,
		labelIds,
	};
}
