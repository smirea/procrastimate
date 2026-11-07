import type { SharedView } from './sharing.ts';
import { sortTasks } from './store.ts';
import { openTasks } from './triggers.ts';
import { projectGroups, type ProjectGroup } from './views.ts';

/** What a public link's page lists: a project under its sections, like the project view, else one group. */
export function sharedGroups(view: SharedView): ProjectGroup[] {
	if (view.target.kind === 'project') return projectGroups(view.tasks, view.sections, view.target.id);
	const ids = new Set(view.tasks.map(task => task.id));
	// A subtask whose parent is shared too shows under its parent's progress instead.
	const tasks = sortTasks(openTasks(view.tasks).filter(task => task.parentId === null || !ids.has(task.parentId)));
	return [{ section: null, tasks }];
}

/** A public link's page title. */
export function sharedTitle(view: SharedView): string {
	const { kind, id } = view.target;
	if (kind === 'project') return view.projects.find(project => project.id === id)?.name ?? 'Shared project';
	if (kind === 'label') return view.labels.find(label => label.id === id)?.name ?? 'Shared label';
	if (kind === 'task') return view.tasks.find(task => task.id === id)?.title ?? 'Shared task';
	return `${view.owner.name}’s tasks`;
}
