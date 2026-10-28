import { getContext, setContext } from 'svelte';
import type { CommentBadge } from 'shared/comments.ts';
import { groupChildren } from 'shared/subtasks.ts';
import { completedAtIn } from 'shared/triggers.ts';
import type { StoreData } from 'shared/store.ts';
import type { Label, Project, Section, Task } from 'shared/task.ts';
import { comments } from './comments.svelte.ts';
import { store } from './store.svelte.ts';
import { sheets } from './ui.svelte.ts';
import { unsynced } from './unsynced.svelte.ts';

/**
 * What a task row reads besides the task. Inside the app it is the store. A public link's page provides its own,
 * read only, so the same list components render tasks the store never holds.
 */
export type Lookup = {
	project: (id: string | null) => Project | undefined;
	section: (id: string | null) => Section | undefined;
	labelsOf: (task: Pick<Task, 'labelIds'>) => Label[];
	task: (id: string) => Task | undefined;
	/** When the task counts as done, which for a task left open under a completed parent is the parent's completion. */
	completedAt: (task: Task) => number | null;
	/** Direct subtasks in sibling order. */
	subtasks: (id: string) => Task[];
	canEdit: (id: string) => boolean;
	/** Undefined for a task without comments. */
	commentBadge: (id: string) => CommentBadge | undefined;
	/** A change to the task waits in this device's upload queue. */
	unsynced: (id: string) => boolean;
	/** Null where rows do not open details. */
	open: ((id: string) => void) | null;
};

const KEY = Symbol('lookup');

const storeLookup: Lookup = {
	project: id => store.project(id),
	section: id => store.section(id),
	labelsOf: task => store.labelsOf(task),
	task: id => store.task(id),
	completedAt: task => store.completedAt(task),
	subtasks: id => store.children(id),
	canEdit: id => store.canEdit(id),
	commentBadge: id => comments.badge(id),
	unsynced: id => unsynced.has(id),
	open: id => sheets.openTask(id),
};

export const useLookup = (): Lookup => getContext<Lookup | undefined>(KEY) ?? storeLookup;

/** A public link carries no comments, so its rows show none. */
export function provideReadOnlyLookup(data: () => Pick<StoreData, 'tasks' | 'projects' | 'sections' | 'labels'>) {
	const byId = <T extends { id: string }>(list: readonly T[]) => new Map(list.map(item => [item.id, item]));
	type Data = ReturnType<typeof data>;
	// This module is not compiled with runes, so the index is memoized on the view's identity, which the page keeps.
	let built: {
		source: Data;
		tasks: Map<string, Task>;
		projects: Map<string, Project>;
		sections: Map<string, Section>;
		labels: Map<string, Label>;
		children: Map<string, Task[]>;
	} | null = null;
	const index = () => {
		const source = data();
		if (built?.source !== source) {
			const { tasks, projects, sections, labels } = source;
			built = {
				source,
				tasks: byId(tasks),
				projects: byId(projects),
				sections: byId(sections),
				labels: byId(labels),
				children: groupChildren(tasks),
			};
		}
		return built;
	};
	setContext<Lookup>(KEY, {
		project: id => (id ? index().projects.get(id) : undefined),
		section: id => (id ? index().sections.get(id) : undefined),
		labelsOf: task => task.labelIds.flatMap(id => index().labels.get(id) ?? []),
		task: id => index().tasks.get(id),
		completedAt: task => completedAtIn(index().tasks, task),
		subtasks: id => index().children.get(id) ?? [],
		canEdit: () => false,
		commentBadge: () => undefined,
		unsynced: () => false,
		open: null,
	});
}
