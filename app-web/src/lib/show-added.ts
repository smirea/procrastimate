import { goto } from '$app/navigation';
import { page } from '$app/state';
import { scheduledDue } from 'shared/triggers.ts';
import type { Task } from 'shared/task.ts';
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
	const [, kind, id] = page.url.pathname.split('/');
	if (kind === 'labels' && id && task.labelIds.includes(id)) return page.url.pathname;
	if (task.projectId) return `/projects/${task.projectId}`;
	return scheduledDue(task, clock.today) ? '/inbox' : '/no-date';
}
