import { page } from '$app/state';
import { canAddTo, reusedDefaults, screenDefaults, type ListDefaults, type Screen } from 'shared/screens.ts';
import type { ListEntry } from 'shared/lists.ts';
import type { Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { clock } from './ui.svelte.ts';

/** The list screen the route shows. Nil on a page that lists no tasks, such as a public link. */
export function currentScreen(): Screen | null {
	const id = page.params.id ?? '';
	switch (page.route.id) {
		case '/inbox':
			return { kind: 'inbox' };
		case '/tomorrow':
			return { kind: 'tomorrow' };
		case '/this-week':
			return { kind: 'this-week' };
		case '/no-date':
			return { kind: 'no-date' };
		case '/completed':
			return { kind: 'completed' };
		case '/projects/[id]':
			return { kind: 'project', id };
		case '/labels/[id]':
			return { kind: 'label', id };
		case '/places/[key]':
			return { kind: 'place', key: page.params.key ?? '' };
		case '/events/[id]':
			return { kind: 'event', id };
		default:
			return null;
	}
}

/** The space someone shared with this user that `screen`'s project or label lives in, if any. */
function spaceOf(screen: Screen | null) {
	if (screen?.kind !== 'project' && screen?.kind !== 'label') return null;
	const home = store.homeOf(screen.id);
	return home === null ? null : (store.spaces[home] ?? null);
}

/** Whether `screen` takes new tasks. A project or label shared with this user to view only takes none. */
export const canAddHere = (screen: Screen) => canAddTo(screen, spaceOf(screen));

/**
 * The projects and labels a new task may land on, in every space, which quick add offers. One shared to view only is
 * left out, because the server refuses a task there.
 */
export const addableProjects = () => store.projects.filter(p => canAddHere({ kind: 'project', id: p.id }));
export const addableLabels = () => store.labels.filter(l => canAddHere({ kind: 'label', id: l.id }));

/** The task the last quick add saved, which the next one on the same list starts from. */
let reused: { path: string; task: Task } | null = null;

/**
 * What quick add starts with: the open list's defaults, or where the last quick add on this list saved its task.
 * A group's own `Add task` row names its screen and always starts with that screen's own.
 */
export function quickAddDefaults(screen?: Screen) {
	const target = screen ?? currentScreen();
	const own = screenDefaults(target, store.own.tasks, spaceOf(target), clock.today);
	if (!screen && reused?.path === page.url.pathname) return reusedDefaults(reused.task, store.labels, own.date);
	return own;
}

/** Quick add just saved `task` on the list at `path`. */
export function reuseAdded(path: string, task: Task) {
	reused = { path, task };
}

/** Leaving the list ends the reuse. */
export function forgetAdded(path: string) {
	if (reused?.path !== path) reused = null;
}

/** Where a top-level list from the catalog opens. */
export function listHref(entry: Pick<ListEntry, 'kind' | 'id'>): string {
	switch (entry.kind) {
		case 'inbox':
		case 'tomorrow':
		case 'this-week':
		case 'no-date':
			return `/${entry.kind}`;
		case 'project':
			return `/projects/${entry.id}`;
		case 'label':
			return `/labels/${entry.id}`;
		case 'place':
			return `/places/${encodeURIComponent(entry.id)}`;
		case 'event':
			return `/events/${encodeURIComponent(entry.id)}`;
		default: {
			const never: never = entry.kind;
			return never;
		}
	}
}
