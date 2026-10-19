import { z } from 'zod';
import type { Screen } from './screens.ts';
import type { Priority, Task } from './task.ts';
import { prioritySchema } from './values.ts';

export const listFilterSchema = z
	.object({ people: z.array(z.string()).nullable(), priorities: z.array(prioritySchema).nullable() })
	.meta({
		id: 'ListFilter',
		description:
			'Which of a list’s tasks show. A null group filters nothing; a group lists what it shows, never empty, so turning off its last choice turns the group off.',
	});
export type ListFilter = z.infer<typeof listFilterSchema>;

export const filterGroupSchema = z.enum(['people', 'priorities']).meta({ id: 'FilterGroup' });
export type FilterGroup = z.infer<typeof filterGroupSchema>;

const option = <T extends z.ZodType>(value: T) => z.object({ value, count: z.number().int(), selected: z.boolean() });
export const personOptionSchema = option(z.string()).meta({
	id: 'PersonOption',
	description: 'A creator to filter by.',
});
export const priorityOptionSchema = option(prioritySchema).meta({
	id: 'PriorityOption',
	description: 'A priority to filter by.',
});

export const filterOptionsSchema = z
	.object({ people: z.array(personOptionSchema), priorities: z.array(priorityOptionSchema) })
	.meta({ id: 'FilterOptions', description: 'The choices a list’s filter menu shows, with their counts.' });
export type FilterOptions = z.infer<typeof filterOptionsSchema>;

export const NO_FILTER: ListFilter = { people: null, priorities: null };

const PRIORITIES: Priority[] = [1, 2, 3, 4];

/** A task's `createdBy` is null before the server stamps it and on imports, both made by the user. */
export const creatorOf = (task: Pick<Task, 'createdBy'>, me: string) => task.createdBy ?? me;

export const filterActive = (filter: ListFilter) => filter.people !== null || filter.priorities !== null;

const keeps = (filter: ListFilter, task: Task, me: string, skip?: FilterGroup) =>
	(skip === 'people' || filter.people === null || filter.people.includes(creatorOf(task, me))) &&
	(skip === 'priorities' || filter.priorities === null || filter.priorities.includes(task.priority));

export function filterTasks(tasks: readonly Task[], filter: ListFilter, me: string): Task[] {
	return filterActive(filter) ? tasks.filter(task => keeps(filter, task, me)) : [...tasks];
}

/**
 * The choices a list's filter menu shows, counted over `tasks` (the list's open rows) as the other group filters them.
 * A choice shows while it counts a task or is picked. People come only when someone else made one of the tasks, the
 * user first, then by count; a group with a single choice to offer is left out, since it could not narrow the list.
 */
export function filterOptions(tasks: readonly Task[], filter: ListFilter, me: string): FilterOptions {
	const count = <T>(
		group: FilterGroup,
		values: readonly T[],
		of: (task: Task) => T,
	): { value: T; count: number; selected: boolean }[] => {
		const shown = tasks.filter(task => keeps(filter, task, me, group));
		const picked = filter[group] as readonly T[] | null;
		const options = values
			.map(value => ({
				value,
				count: shown.filter(task => of(task) === value).length,
				selected: picked?.includes(value) ?? false,
			}))
			.filter(option => option.count > 0 || option.selected);
		return options.length > 1 || picked !== null ? options : [];
	};
	const creators = [...new Set([me, ...tasks.map(task => creatorOf(task, me)), ...(filter.people ?? [])])];
	const byCount = (id: string) => tasks.filter(task => creatorOf(task, me) === id).length;
	const people = [me, ...creators.slice(1).toSorted((a, b) => byCount(b) - byCount(a) || (a < b ? -1 : a > b ? 1 : 0))];
	return {
		people: count('people', people, task => creatorOf(task, me)),
		priorities: count('priorities', PRIORITIES, task => task.priority),
	};
}

/** Turning a group on picks every choice it offers, so the user narrows it from all; turning it off shows everything. */
export function toggleGroup(filter: ListFilter, group: FilterGroup, options: FilterOptions): ListFilter {
	if (filter[group] !== null) return { ...filter, [group]: null };
	return { ...filter, [group]: options[group].map(option => option.value) };
}

/** With the group off, picking a choice shows only it. */
export function toggleOption<G extends FilterGroup>(
	filter: ListFilter,
	group: G,
	value: NonNullable<ListFilter[G]>[number],
): ListFilter {
	const picked = (filter[group] ?? []) as readonly (typeof value)[];
	const next = picked.includes(value) ? picked.filter(v => v !== value) : [...picked, value];
	return { ...filter, [group]: next.length ? next : null };
}

/** Each list keeps its own filter, on this device. Inbox's day headings share Inbox's. */
export function filterKey(screen: Screen): string {
	switch (screen.kind) {
		case 'inbox':
		case 'tomorrow':
		case 'this-week':
		case 'no-date':
		case 'completed':
			return screen.kind;
		case 'project':
		case 'label':
		case 'event':
			return `${screen.kind}:${screen.id}`;
		case 'place':
			return `place:${screen.key}`;
		default: {
			const never: never = screen;
			return never;
		}
	}
}
