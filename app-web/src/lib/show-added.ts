import { goto } from '$app/navigation';
import { page } from '$app/state';
import { screenHolds, type Screen } from 'shared/screens.ts';
import { placeKey, scheduledDue } from 'shared/triggers.ts';
import { store } from './store.svelte.ts';
import type { Task } from 'shared/task.ts';
import { currentScreen } from './screen.ts';
import { clock, reveal, sheets, toasts } from './ui.svelte.ts';

/**
 * Shows a task just added from quick add or Ramble: the open list when it already shows the task, else its project,
 * else Inbox when it has a day or No date when it has none. The row then flashes. Returns the list's path.
 */
export function showAdded(task: Task) {
	const path = listOf(task);
	if (path !== page.url.pathname) void goto(path);
	reveal.show(task.id);
	return path;
}

let confirmation: number | null = null;

/**
 * Quick add stays open after a save, so nothing navigates: the open list flashes the row when it shows the task, and
 * otherwise a toast names the list it went to, with a `Show` that closes quick add and goes there. Each save replaces
 * the last one's toast, so a batch leaves one.
 */
export function confirmAdded(task: Task) {
	const path = listOf(task);
	if (confirmation !== null) toasts.dismiss(confirmation);
	confirmation = null;
	if (path === page.url.pathname) return reveal.show(task.id);
	confirmation = toasts.show(`Added to ${listName(path, task)}`, {
		label: 'Show',
		run: () => {
			if (sheets.current.kind === 'quick-add') sheets.close();
			showAdded(task);
		},
	});
}

function listName(path: string, task: Task) {
	if (path === '/inbox') return 'Inbox';
	if (path === '/no-date') return 'No date';
	return store.project(task.projectId)?.name ?? 'its project';
}

/** A saved place's screen is its label's, but it holds the tasks at the place. */
function holding(screen: Screen | null): Screen | null {
	const place = screen?.kind === 'label' ? store.label(screen.id)?.place : null;
	return place ? { kind: 'place', key: placeKey(place) } : screen;
}

function listOf(task: Task) {
	if (screenHolds(holding(currentScreen()), task, clock.today)) return page.url.pathname;
	if (task.projectId) return `/projects/${task.projectId}`;
	return scheduledDue(task, clock.today) ? '/inbox' : '/no-date';
}
