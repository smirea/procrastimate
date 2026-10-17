import { page } from '$app/state';
import { screenDefaults, type Screen } from 'shared/screens.ts';
import { store } from './store.svelte.ts';

/** The list screen the route shows. Nil on a page that lists no tasks, such as a public link. */
export function currentScreen(): Screen | null {
	const id = page.params.id ?? '';
	switch (page.route.id) {
		case '/inbox':
			return { kind: 'inbox' };
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

/** What quick add starts with on `screen`, the open one unless a section's add row names its own. */
export const quickAddDefaults = (screen: Screen | null = currentScreen()) => screenDefaults(screen, store.own.tasks);
