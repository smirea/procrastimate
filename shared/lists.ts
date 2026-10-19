import { z } from 'zod';
import { personSchema } from './sharing.ts';
import { sharedEntries, type SharedSpaceData } from './space-routing.ts';
import { projectsInOrder, type StoreData } from './store.ts';
import type { DateKey, Label } from './task.ts';
import { eventGroups, placeGroups } from './triggers.ts';
import { dueDays, inboxTasks, openCounts, type DueDays } from './views.ts';

/**
 * The top-level lists of tasks: every screen a user navigates to, pins, or picks a list from. Each surface (the web
 * sidebar, iOS Browse, the tab bar and its menus) reads this one catalog and only filters it for its use, so they never
 * disagree on which lists exist, what they are called, or their order. See `docs/decisions/lists.md`.
 */

export const listKindSchema = z
	.enum(['inbox', 'tomorrow', 'this-week', 'no-date', 'project', 'label', 'place', 'event'])
	.meta({ id: 'ListKind' });
export type ListKind = z.infer<typeof listKindSchema>;

export const listEntrySchema = z
	.object({
		kind: listKindSchema,
		id: z.string().meta({ description: "The project's, label's, or event's id, a place's key, else the kind." }),
		name: z.string(),
		count: z.number().int(),
		owner: personSchema.nullable().meta({ description: 'Who shared it, for a list in a space shared with this user.' }),
	})
	.meta({ id: 'ListEntry' });
export type ListEntry = z.infer<typeof listEntrySchema>;

export const listGroupKindSchema = z
	.enum(['lists', 'projects', 'shared', 'places', 'events', 'labels'])
	.meta({ id: 'ListGroupKind' });
export type ListGroupKind = z.infer<typeof listGroupKindSchema>;

export const listGroupSchema = z
	.object({ kind: listGroupKindSchema, title: z.string(), entries: z.array(listEntrySchema) })
	.meta({ id: 'ListGroup' });
export type ListGroup = z.infer<typeof listGroupSchema>;

export type ListSource = {
	own: Pick<StoreData, 'tasks' | 'projects' | 'labels'>;
	shared: readonly SharedSpaceData[];
};

const TITLES: Record<ListGroupKind, string> = {
	lists: 'Lists',
	projects: 'Projects',
	shared: 'Shared with me',
	places: 'Places',
	events: 'Events',
	labels: 'Labels',
};

const NAMES = { inbox: 'Inbox', tomorrow: 'Tomorrow', 'this-week': 'This week', 'no-date': 'No date' } as const;

const rows = (due: DueDays) => due.overdue.length + due.today.length + due.days.reduce((n, g) => n + g.tasks.length, 0);

const labelsByName = (labels: readonly Label[]) =>
	labels.toSorted((a, b) => a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' }));

/**
 * Every top-level list, grouped and in order, empty ones included: a list stays put while it has no tasks, so menus
 * never shift under the user. Places and events exist only while open tasks point at them. Each count is the open rows
 * its screen lists, except Inbox, which counts what its badge does: overdue and today's tasks. A shared list shows its
 * owner instead of a count, so it counts 0.
 */
export function listCatalog(source: ListSource, today: DateKey): ListGroup[] {
	const { tasks, projects, labels } = source.own;
	const fixed = (kind: keyof typeof NAMES, count: number): ListEntry => ({
		kind,
		id: kind,
		name: NAMES[kind],
		count,
		owner: null,
	});
	const inbox = dueDays(tasks, today, 'inbox');
	const counts = openCounts(tasks, labels);
	const groups: Record<ListGroupKind, ListEntry[]> = {
		lists: [
			fixed('inbox', inbox.overdue.length + inbox.today.length),
			fixed('tomorrow', rows(dueDays(tasks, today, 'tomorrow'))),
			fixed('this-week', rows(dueDays(tasks, today, 'this-week'))),
			fixed('no-date', inboxTasks(tasks, today).length),
		],
		projects: projectsInOrder(projects).map(p => ({
			kind: 'project',
			id: p.id,
			name: p.name,
			count: counts.projects.get(p.id) ?? 0,
			owner: null,
		})),
		shared: sharedEntries(source.shared).flatMap(entry =>
			entry.kind === 'task' ? [] : [{ kind: entry.kind, id: entry.id, name: entry.name, count: 0, owner: entry.owner }],
		),
		places: placeGroups(tasks, labels).map(g => ({
			kind: 'place',
			id: g.key,
			name: g.name,
			count: g.count,
			owner: null,
		})),
		events: eventGroups(tasks, today).map(g => ({
			kind: 'event',
			id: g.id,
			name: g.title,
			count: g.count,
			owner: null,
		})),
		labels: labelsByName(labels).map(l => ({
			kind: 'label',
			id: l.id,
			name: l.name,
			count: counts.labels.get(l.id) ?? 0,
			owner: null,
		})),
	};
	return listGroupKindSchema.options.map(kind => ({ kind, title: TITLES[kind], entries: groups[kind] }));
}
