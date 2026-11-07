import { parseQuickAdd, type ParsedQuickAdd } from './quick-add.ts';
import { typedOver } from './quick-add-merge.ts';
import type { TaskPatch } from './store.ts';
import type { Due, Label, Project, Section, Task } from './task.ts';

/**
 * Task details' title: it parses like quick add, the chips show what it will apply before Enter or blur commits it,
 * and a date change keeps or drops the repeat.
 */

export type TitleContext = {
	now: Date;
	projects: readonly Project[];
	sections: readonly Section[];
	labels: readonly Label[];
};

/**
 * A subtask's title never parses `#Name` or `/Name`, since a subtask always shares its root task's project and sits
 * under its parent rather than in a section.
 */
export function parseTitle(title: string, task: Task, context: TitleContext): ParsedQuickAdd {
	const topLevel = task.parentId === null;
	return parseQuickAdd(title, {
		literal: task.titleMode === 'literal',
		now: context.now,
		projects: topLevel ? context.projects : [],
		sections: topLevel ? context.sections : [],
		labels: context.labels,
		projectId: task.projectId,
		due: task.due,
	});
}

/** The fields the chips show: the task's, or what the edited title will apply to it. */
export type TitleDraft = Pick<
	Task,
	'title' | 'due' | 'recurrence' | 'priority' | 'projectId' | 'sectionId' | 'labelIds' | 'reminders' | 'location'
>;

const own = ({ title, due, recurrence, priority, projectId, sectionId, labelIds, reminders, location }: Task) => ({
	title,
	due,
	recurrence,
	priority,
	projectId,
	sectionId,
	labelIds,
	reminders,
	location,
});

/**
 * Typed values win over the task's, labels and reminders add to its own, and a typed saved place keeps the task's
 * trigger, as picking one does. `parsed` is null while the title is unedited.
 */
export function titleDraft(task: Task, title: string, parsed: ParsedQuickAdd | null): TitleDraft {
	if (title === task.title || !parsed?.title) return own(task);
	return {
		title: parsed.title,
		...typedOver(task, parsed, task.event),
		labelIds: [...new Set([...task.labelIds, ...parsed.labelIds])],
		reminders: [...task.reminders, ...parsed.reminders],
		location: parsed.location ? { ...parsed.location, trigger: task.location?.trigger ?? 'arrive' } : task.location,
	};
}

/**
 * The phrases the field highlights: only an edit's, since the edit is what applies them. A phrase left in the saved
 * title stays text, so highlighting it would read as parsed while the chips keep the task's own values.
 */
export const titleTokens = (task: Task, title: string, parsed: ParsedQuickAdd | null) =>
	title === task.title ? [] : (parsed?.tokens ?? []);

/** An edit that leaves no title reverts the field to the task's. */
export type TitleCommit = { kind: 'unchanged' } | { kind: 'revert' } | { kind: 'update'; patch: TitleDraft };

export function commitTitle(task: Task, title: string, parsed: ParsedQuickAdd | null): TitleCommit {
	if (title === task.title) return { kind: 'unchanged' };
	if (!parsed?.title) return { kind: 'revert' };
	return { kind: 'update', patch: titleDraft(task, title, parsed) };
}

/** A repeat needs a date to count from, so removing the date removes the repeat. */
export const setDue = (task: Pick<Task, 'recurrence'>, due: Due | null): TaskPatch => ({
	due,
	recurrence: due ? task.recurrence : null,
});
