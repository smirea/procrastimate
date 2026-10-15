import { getContext, setContext } from 'svelte';
import { groupChildren, progressOf, type Progress } from 'shared/subtasks.ts';
import type { StoreData } from 'shared/store.ts';
import type { Label, Project, Task } from 'shared/task.ts';
import { store } from './store.svelte.ts';
import { sheets } from './ui.svelte.ts';

/**
 * What a task row reads besides the task. Inside the app it is the store. A public link's page provides its own,
 * read only, so the same list components render tasks the store never holds.
 */
export type Lookup = {
	project: (id: string | null) => Project | undefined;
	labelsOf: (task: Pick<Task, 'labelIds'>) => Label[];
	task: (id: string) => Task | undefined;
	progress: (id: string) => Progress | null;
	canEdit: (id: string) => boolean;
	/** Null where rows do not open details. */
	open: ((id: string) => void) | null;
};

const KEY = Symbol('lookup');

const storeLookup: Lookup = {
	project: id => store.project(id),
	labelsOf: task => store.labelsOf(task),
	task: id => store.task(id),
	progress: id => store.progress(id),
	canEdit: id => store.canEdit(id),
	open: id => sheets.openTask(id),
};

export const useLookup = (): Lookup => getContext<Lookup | undefined>(KEY) ?? storeLookup;

export function provideReadOnlyLookup(data: () => StoreData) {
	const children = () => groupChildren(data().tasks);
	setContext<Lookup>(KEY, {
		project: id => (id ? data().projects.find(p => p.id === id) : undefined),
		labelsOf: task => task.labelIds.flatMap(id => data().labels.find(l => l.id === id) ?? []),
		task: id => data().tasks.find(t => t.id === id),
		progress: id => progressOf(children().get(id) ?? []),
		canEdit: () => false,
		open: null,
	});
}
