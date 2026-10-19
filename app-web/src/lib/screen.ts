import { page } from '$app/state';
import { canAddTo, screenDefaults, type Screen } from 'shared/screens.ts';
import type { ListEntry } from 'shared/lists.ts';
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

/** What quick add starts with on `screen`, the open one unless a section's add row names its own. */
export const quickAddDefaults = (screen: Screen | null = currentScreen()) =>
	screenDefaults(screen, store.own.tasks, spaceOf(screen), clock.today);

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
