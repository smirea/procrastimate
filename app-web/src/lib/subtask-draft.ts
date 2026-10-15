import { parseQuickAdd, type ParsedQuickAdd } from 'shared/quick-add.ts';
import type { NewTask } from 'shared/store.ts';
import { store } from './store.svelte.ts';
import { clock } from './ui.svelte.ts';

/** A subtask line parses like quick add without `#` projects, because a subtask always shares its root's project. */
export function parseSubtask(text: string): ParsedQuickAdd {
	return parseQuickAdd(text, { now: new Date(clock.now), projects: [], labels: store.labels, due: null });
}

export function subtaskTask({ title, due, recurrence, priority, reminders, labelIds }: ParsedQuickAdd): NewTask | null {
	return title ? { title, due, recurrence, priority, reminders, labelIds, projectId: null } : null;
}
