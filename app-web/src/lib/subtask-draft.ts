import { parseSubtask as parseLine, type ParsedQuickAdd } from 'shared/quick-add.ts';
import type { NewTask } from 'shared/store.ts';
import { store } from './store.svelte.ts';
import { clock } from './ui.svelte.ts';

export function parseSubtask(text: string, literal = false): ParsedQuickAdd {
	return parseLine(text, { now: new Date(clock.now), labels: store.labels, literal });
}

export function subtaskTask({ title, due, recurrence, priority, reminders, labelIds }: ParsedQuickAdd): NewTask | null {
	return title ? { title, due, recurrence, priority, reminders, labelIds, projectId: null } : null;
}
