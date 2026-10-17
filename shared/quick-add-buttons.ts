import { z } from 'zod';

/**
 * The attribute buttons of quick add's chip row, in their default order. `location` and `event` exist only on iOS, which is
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

const unique = (buttons: readonly QuickAddButton[]) => [...new Set(buttons)];

/**
 * Pins or unpins one button. The stored list is the row's order, so a newly pinned button goes last. Repeats drop, so
 * two devices store the same list.
 */
export function toggleButton(visible: readonly QuickAddButton[], button: QuickAddButton): QuickAddButton[] {
	const pinned = unique(visible);
	return pinned.includes(button) ? pinned.filter(b => b !== button) : [...pinned, button];
}

/**
 * Moves a pinned button just before `before`, or to the end when `before` is null. Taking a neighbor instead of an
 * index lets the web, which hides `location` and `event`, reorder its rows without moving the iOS-only ones.
 */
export function moveButton(
	visible: readonly QuickAddButton[],
	button: QuickAddButton,
	before: QuickAddButton | null,
): QuickAddButton[] {
	const rest = unique(visible).filter(b => b !== button);
	const at = before === null ? -1 : rest.indexOf(before);
	return at === -1 ? [...rest, button] : [...rest.slice(0, at), button, ...rest.slice(at)];
}

/**
 * The buttons the row shows: each supported pinned one in the stored order, then each supported one that is `shown`
 * because it holds a value or was opened from the `+` menu, in the default order. A hidden button never hides a value
 * the task will be saved with. Passing `supported` as `shown` lists every button, pinned first, as settings and the
 * `+` menu do.
 */
export function rowButtons(
	visible: readonly QuickAddButton[],
	shown: readonly QuickAddButton[],
	supported: readonly QuickAddButton[],
): QuickAddButton[] {
	const pinned = unique(visible).filter(button => supported.includes(button));
	const extra = QUICK_ADD_BUTTONS.filter(b => shown.includes(b) && supported.includes(b) && !pinned.includes(b));
	return [...pinned, ...extra];
}
