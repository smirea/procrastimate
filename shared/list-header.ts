import { z } from 'zod';

export const headerItemSchema = z
	.enum([
		'share',
		'copy',
		'show-completed',
		'sort',
		'add-section',
		'rename',
		'color',
		'icon',
		'edit-place',
		'save-place',
		'delete',
	])
	.meta({ id: 'HeaderItem', description: 'An entry of a list’s `…` menu.' });
export type HeaderItem = z.infer<typeof headerItemSchema>;

/**
 * A top-level list as its header sees it. `own` is false for a project or label another space shared with the user,
 * which only its owner changes; `place` marks a label that is a saved place, and `saveable` an unsaved place whose
 * tasks still name a spot to save.
 */
export type HeaderList =
	| { kind: 'inbox' | 'tomorrow' | 'this-week' | 'no-date' | 'completed' | 'event' }
	| { kind: 'project'; own: boolean }
	| { kind: 'label'; own: boolean; place: boolean }
	| { kind: 'place'; saveable: boolean };

export const listHeaderSchema = z
	.object({ filters: z.boolean(), common: z.array(headerItemSchema), specific: z.array(headerItemSchema) })
	.meta({
		id: 'ListHeader',
		description:
			'One header for every list: the filter menu at the top left when the list has one, and the `…` menu at the top right. The menu leads with what every list shares, in one order, then the list’s own entries after a separator, with delete last.',
	});
export type ListHeader = z.infer<typeof listHeaderSchema>;

export function listHeader(list: HeaderList): ListHeader {
	switch (list.kind) {
		case 'inbox':
		case 'tomorrow':
		case 'this-week':
		case 'event':
			return { filters: true, common: ['copy'], specific: [] };
		case 'no-date':
			return { filters: true, common: ['copy'], specific: ['sort'] };
		case 'completed':
			return { filters: false, common: ['copy'], specific: [] };
		case 'project':
			return list.own
				? { filters: true, common: ['share', 'copy', 'show-completed'], specific: ['add-section', 'rename', 'icon', 'delete'] }
				: { filters: true, common: ['copy', 'show-completed'], specific: [] };
		case 'label':
			if (!list.own) return { filters: true, common: ['copy', 'show-completed'], specific: [] };
			// Sharing goes by the tasks carrying a label, and a saved place's tasks carry none.
			return list.place
				? { filters: true, common: ['copy', 'show-completed'], specific: ['rename', 'color', 'edit-place', 'delete'] }
				: { filters: true, common: ['share', 'copy', 'show-completed'], specific: ['rename', 'color', 'delete'] };
		case 'place':
			return { filters: true, common: ['copy'], specific: list.saveable ? ['save-place'] : [] };
		default: {
			const never: never = list;
			return never;
		}
	}
}
