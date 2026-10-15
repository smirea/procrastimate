import type { SpaceSection } from 'shared/snapshot.ts';
import type { NewTask, StoreData } from 'shared/store.ts';
import { sortTasks } from 'shared/store.ts';

/**
 * Which space each entity lives in. `null` is the signed-in user's own space; a string is the owner id of a
 * shared section. Every command runs on exactly one space's data, so these decide where it goes.
 */
export type Home = string | null;

export type Sections = Readonly<Record<string, SpaceSection>>;

/** The owner of every entity in a shared section, by id. Ids are UUIDs, so one map serves every kind. */
export function homes(spaces: Sections): Map<string, string> {
	const map = new Map<string, string>();
	for (const [owner, section] of Object.entries(spaces)) {
		for (const entity of [...section.tasks, ...section.projects, ...section.labels]) map.set(entity.id, owner);
	}
	return map;
}

/**
 * A new task takes its parent's space, else its project's, else the space of a label it carries from a label
 * view, else the creator's own.
 */
export function creationHome(
	homeOf: (id: string) => Home,
	input: Pick<NewTask, 'projectId' | 'labelIds'>,
	parentId: string | null,
): Home {
	if (parentId) return homeOf(parentId);
	if (input.projectId) return homeOf(input.projectId);
	for (const id of input.labelIds) {
		const home = homeOf(id);
		if (home !== null) return home;
	}
	return null;
}

/** Drops the project and labels that belong to another space, since nothing crosses spaces. */
export function fitToSpace<T extends Pick<NewTask, 'projectId' | 'labelIds'>>(data: StoreData, input: T): T {
	const projectId = input.projectId && data.projects.some(p => p.id === input.projectId) ? input.projectId : null;
	const labelIds = input.labelIds.filter(id => data.labels.some(l => l.id === id));
	return { ...input, projectId, labelIds };
}

/** Own data first, then each section, as one list for lookups, details, children, and shared pages. */
export function merged(own: StoreData, spaces: Sections): StoreData {
	const sections = Object.values(spaces);
	if (sections.length === 0) return own;
	return {
		tasks: sortTasks([...own.tasks, ...sections.flatMap(s => s.tasks)]),
		projects: [...own.projects, ...sections.flatMap(s => s.projects)],
		labels: [...own.labels, ...sections.flatMap(s => s.labels)],
	};
}

export const emptySection = (owner: SpaceSection['owner']): SpaceSection => ({
	owner,
	cursor: 0,
	outbox: [],
	epoch: 0,
	scope: '',
	readOnly: [],
	tasks: [],
	projects: [],
	labels: [],
});
