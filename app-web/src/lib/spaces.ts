import type { Access, SpaceRows } from 'shared/local-rows.ts';
import type { Person } from 'shared/sharing.ts';
import { projectsInOrder, sortTasks, type NewTask, type StoreData } from 'shared/store.ts';

/**
 * Which space each entity lives in. `null` is the signed-in user's own space; a string is the owner id of a
 * shared one. Every command runs on exactly one space's data, so these decide where it goes.
 */
export type Home = string | null;

/** `readOnly` is the tasks whose `access` row says `view`; `access` is every row of the space to this user, by id. */
export type SharedSpace = {
	owner: string;
	data: StoreData;
	readOnly: ReadonlySet<string>;
	access: readonly Access[];
};
export type Spaces = Readonly<Record<string, SharedSpace>>;

export const emptyData = (): StoreData => ({
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	comments: [],
	reads: [],
});

/** The web's view of one shared space: the rows `LocalRows` holds for it, and the tasks it may only view. */
export function sharedSpace(owner: string, { data, access }: SpaceRows): SharedSpace {
	const readOnly = new Set(access.filter(row => row.kind === 'task' && row.role === 'view').map(row => row.entityId));
	return { owner, data, readOnly, access };
}

/** Ids are UUIDs, so one map serves every kind. */
export function homes(spaces: Spaces): Map<string, string> {
	const map = new Map<string, string>();
	for (const { owner, data } of Object.values(spaces)) {
		for (const entity of [...data.tasks, ...data.projects, ...data.sections, ...data.labels]) map.set(entity.id, owner);
	}
	return map;
}

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

/** Drops the project, section, and labels that belong to another space, since nothing crosses spaces. */
export function fitToSpace<T extends Pick<NewTask, 'projectId' | 'sectionId' | 'labelIds'>>(
	data: Pick<StoreData, 'projects' | 'sections' | 'labels'>,
	input: T,
): T {
	const projectId = input.projectId && data.projects.some(p => p.id === input.projectId) ? input.projectId : null;
	const sectionId = input.sectionId && data.sections.some(s => s.id === input.sectionId) ? input.sectionId : null;
	const labelIds = input.labelIds.filter(id => data.labels.some(l => l.id === id));
	return { ...input, projectId, sectionId, labelIds };
}

/** The read markers are the user's own, which cover every space's tasks. */
export function merged(own: StoreData, spaces: Spaces): StoreData {
	const shared = Object.values(spaces).map(space => space.data);
	if (shared.length === 0) return own;
	return {
		tasks: sortTasks([...own.tasks, ...shared.flatMap(s => s.tasks)]),
		projects: [...own.projects, ...shared.flatMap(s => s.projects)],
		sections: [...own.sections, ...shared.flatMap(s => s.sections)],
		labels: [...own.labels, ...shared.flatMap(s => s.labels)],
		comments: [...own.comments, ...shared.flatMap(s => s.comments)],
		reads: own.reads,
	};
}

export type SharedEntry = { kind: 'project' | 'label' | 'task'; id: string; name: string; owner: Person };

/**
 * What the sidebar lists under "Shared with me". A space holds only what its owner shared with this user, so every
 * project and label in it is listed, and each task that neither of them leads to: a top-level task outside every
 * visible project and label.
 */
export function sharedEntries(spaces: Spaces, person: (id: string) => Person): SharedEntry[] {
	return Object.values(spaces).flatMap(({ owner: ownerId, data }) => {
		const owner = person(ownerId);
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
			...data.labels.map(l => ({ kind: 'label' as const, id: l.id, name: l.name, owner })),
			...loose.map(t => ({ kind: 'task' as const, id: t.id, name: t.title, owner })),
		];
	});
}
