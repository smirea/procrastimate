import { goto } from '$app/navigation';
import { page } from '$app/state';
import { screenHolds } from 'shared/screens.ts';
import { scheduledDue } from 'shared/triggers.ts';
import type { Task } from 'shared/task.ts';
import { currentScreen } from './screen.ts';
import { clock, reveal } from './ui.svelte.ts';

/**
 * Shows a task just added from quick add or Ramble: the open list when it already shows the task, else its project,
 * else Inbox when it has a day or No date when it has none. The row then flashes.
 */
export function showAdded(task: Task) {
	const path = listOf(task);
	if (path !== page.url.pathname) void goto(path);
	reveal.show(task.id);
}

function listOf(task: Task) {
	if (screenHolds(currentScreen(), task, clock.today)) return page.url.pathname;
	if (task.projectId) return `/projects/${task.projectId}`;
	return scheduledDue(task, clock.today) ? '/inbox' : '/no-date';
}
