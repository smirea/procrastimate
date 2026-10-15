import { z } from 'zod';

/**
 * The attribute buttons of quick add's chip row, in row order. `location` and `event` exist only on iOS, which is
 * the only client that sets them, so the web passes its own `supported` list.
 */
export const QUICK_ADD_BUTTONS = [
	'date',
	'priority',
	'reminders',
	'repeat',
	'labels',
	'subtasks',
	'location',
	'event',
] as const;
export const quickAddButtonSchema = z.enum(QUICK_ADD_BUTTONS).meta({ id: 'QuickAddButton' });
export type QuickAddButton = z.infer<typeof quickAddButtonSchema>;

/** Todoist's own default row: the date, the flag, and reminders, plus the subtask checklist quick add had pinned. */
export const DEFAULT_QUICK_ADD_BUTTONS: QuickAddButton[] = ['date', 'priority', 'reminders', 'subtasks'];

const inOrder = (buttons: ReadonlySet<QuickAddButton>) => QUICK_ADD_BUTTONS.filter(button => buttons.has(button));

/** Pins or unpins one button. The result is in row order with no repeats, so two devices store the same list. */
export function toggleButton(visible: readonly QuickAddButton[], button: QuickAddButton): QuickAddButton[] {
	const next = new Set(visible);
	if (next.has(button)) next.delete(button);
	else next.add(button);
	return inOrder(next);
}

/**
 * The buttons the row shows, in row order: each supported one that is pinned, or `shown` because it holds a value
 * or was opened from the `+` menu. A hidden button never hides a value the task will be saved with.
 */
export function rowButtons(
	visible: readonly QuickAddButton[],
	shown: readonly QuickAddButton[],
	supported: readonly QuickAddButton[],
): QuickAddButton[] {
	const on = new Set([...visible, ...shown]);
	return QUICK_ADD_BUTTONS.filter(button => on.has(button) && supported.includes(button));
}
