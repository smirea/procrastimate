import type { Person } from './sharing.ts';
import { projectsInOrder, type NewTask, type StoreData, type TaskPatch } from './store.ts';

/**
 * Which space each command runs in, the same on both clients. A space is the user's own (`null`) or one another user
 * shares with them, named by its owner's id, and nothing crosses spaces: a task's project, section, and labels are
 * always of its own space.
 */

export type Home = string | null;

/** Every shared entity's owner by id; the user's own entities are absent. Ids are UUIDs, so one map serves every kind. */
export type Homes = Readonly<Record<string, string>>;

const homeOf = (homes: Homes, id: string): Home => homes[id] ?? null;

/** A new task's space: its parent's, else its project's, else the first shared label's, else the user's own. */
export function creationHome(
	homes: Homes,
	input: Pick<NewTask, 'projectId' | 'labelIds'>,
	parentId: string | null,
): Home {
	if (parentId) return homeOf(homes, parentId);
	if (input.projectId) return homeOf(homes, input.projectId);
	for (const id of input.labelIds ?? []) {
		const home = homeOf(homes, id);
		if (home !== null) return home;
	}
	return null;
}

type Lists = Pick<StoreData, 'projects' | 'sections' | 'labels'>;

/** A new task without the project, section, and labels of other spaces. */
export function fitToSpace<T extends Pick<NewTask, 'projectId' | 'sectionId' | 'labelIds'>>(data: Lists, input: T): T {
	const projectId = input.projectId && data.projects.some(p => p.id === input.projectId) ? input.projectId : null;
	const sectionId = input.sectionId && data.sections.some(s => s.id === input.sectionId) ? input.sectionId : null;
	const labelIds = (input.labelIds ?? []).filter(id => data.labels.some(l => l.id === id));
	return { ...input, projectId, sectionId, labelIds };
}

/**
 * An edit without moves into another space: a project or section of another space leaves the task where it is, and
 * labels of another space are dropped. Clearing the project or section still applies.
 */
export function fitPatch(data: Lists, patch: TaskPatch): TaskPatch {
	const { projectId, sectionId, labelIds, ...rest } = patch;
	return {
		...rest,
		...(projectId !== undefined && (projectId === null || data.projects.some(p => p.id === projectId))
			? { projectId }
			: {}),
		...(sectionId !== undefined && (sectionId === null || data.sections.some(s => s.id === sectionId))
			? { sectionId }
			: {}),
		...(labelIds !== undefined ? { labelIds: labelIds.filter(id => data.labels.some(l => l.id === id)) } : {}),
	};
}

export type SharedSpaceData = { owner: Person; data: Pick<StoreData, 'tasks' | 'projects' | 'labels'> };
export type SharedEntry = { kind: 'project' | 'label' | 'task'; id: string; name: string; owner: Person };

const byName = (a: { name: string }, b: { name: string }) =>
	a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' });

/**
 * What "Shared with me" lists: the spaces by their owner's name, and in each its projects in their order, its labels
 * by name, then each top-level task that no project or label of the space leads to.
 */
export function sharedEntries(spaces: readonly SharedSpaceData[]): SharedEntry[] {
	return spaces
		.toSorted((a, b) => byName(a.owner, b.owner) || (a.owner.id < b.owner.id ? -1 : a.owner.id > b.owner.id ? 1 : 0))
		.flatMap(({ owner, data }) => {
			const projects = new Set(data.projects.map(p => p.id));
			const labels = new Set(data.labels.map(l => l.id));
			const tasks = new Set(data.tasks.map(t => t.id));
			const loose = data.tasks.filter(
				t =>
					!(t.parentId && tasks.has(t.parentId)) &&
					!(t.projectId && projects.has(t.projectId)) &&
					!t.labelIds.some(id => labels.has(id)),
			);
			return [
				...projectsInOrder(data.projects).map(p => ({ kind: 'project' as const, id: p.id, name: p.name, owner })),
				...data.labels.toSorted(byName).map(l => ({ kind: 'label' as const, id: l.id, name: l.name, owner })),
				...loose.map(t => ({ kind: 'task' as const, id: t.id, name: t.title, owner })),
			];
		});
}
