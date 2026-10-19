import { goto } from '$app/navigation';
import { page } from '$app/state';
import { screenHolds, type Screen } from 'shared/screens.ts';
import { placeKey, scheduledDue } from 'shared/triggers.ts';
import { store } from './store.svelte.ts';
import type { Task } from 'shared/task.ts';
import { currentScreen } from './screen.ts';
import { clock, reveal } from './ui.svelte.ts';

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
