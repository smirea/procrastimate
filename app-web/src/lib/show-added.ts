import { goto } from '$app/navigation';
import { page } from '$app/state';
import { addedScreen, screenPath } from 'shared/screens.ts';
import { store } from './store.svelte.ts';
import type { Task } from 'shared/task.ts';
import { currentScreen } from './screen.ts';
import { clock } from './clock.svelte.ts';
import { reveal } from './sheets.svelte.ts';

/**
 * Shows a task just added from Ramble: the open list when it already shows the task, else its project,
 * else Inbox when it has a day or No date when it has none. The row then flashes. Returns the list's path.
 */
export function showAdded(task: Task) {
	const path = listOf(task);
	// Details may open on top with its title focused, which a resetting navigation would blur; the reveal scrolls instead.
	if (path !== page.url.pathname) void goto(path, { reset: false });
	reveal.show(task.id);
	return path;
}

function listOf(task: Task) {
	const screen = addedScreen(currentScreen(), task, store.labels, clock.today);
	return screen ? screenPath(screen) : page.url.pathname;
}
