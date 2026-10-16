import type { Person } from 'shared/sharing.ts';
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
		for (const entity of [...section.tasks, ...section.projects, ...section.sections, ...section.labels])
			map.set(entity.id, owner);
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

/** A shared section as store data. Read markers live only in the user's own space, so a section has none. */
export const sectionStore = ({ tasks, projects, sections, labels, comments }: SpaceSection): StoreData => ({
	tasks,
	projects,
	sections,
	labels,
	comments,
	reads: [],
});

/**
 * Own data first, then each section, as one list for lookups, details, children, and shared pages. The read markers
 * are the user's own, which cover every space's tasks.
 */
export function merged(own: StoreData, spaces: Sections): StoreData {
	const sections = Object.values(spaces);
	if (sections.length === 0) return own;
	return {
		tasks: sortTasks([...own.tasks, ...sections.flatMap(s => s.tasks)]),
		projects: [...own.projects, ...sections.flatMap(s => s.projects)],
		sections: [...own.sections, ...sections.flatMap(s => s.sections)],
		labels: [...own.labels, ...sections.flatMap(s => s.labels)],
		comments: [...own.comments, ...sections.flatMap(s => s.comments)],
		reads: own.reads,
	};
}

export type SharedEntry = { kind: 'project' | 'label' | 'task'; id: string; name: string; owner: Person };

/** What the sidebar lists under "Shared with me": each thing its owner shared with this user that is still there. */
export function sharedEntries(spaces: Sections): SharedEntry[] {
	return Object.values(spaces).flatMap(({ owner, targets, tasks, projects, labels }) =>
		targets.flatMap(({ kind, id }): SharedEntry[] => {
			if (kind === 'project') return projects.filter(p => p.id === id).map(p => ({ kind, id, name: p.name, owner }));
			if (kind === 'label') return labels.filter(l => l.id === id).map(l => ({ kind, id, name: l.name, owner }));
			if (kind === 'task') return tasks.filter(t => t.id === id).map(t => ({ kind, id, name: t.title, owner }));
			return projects.map(p => ({ kind: 'project' as const, id: p.id, name: p.name, owner }));
		}),
	);
}

export const emptySection = (owner: SpaceSection['owner']): SpaceSection => ({
	owner,
	cursor: 0,
	outbox: [],
	epoch: 0,
	scope: '',
	readOnly: [],
	targets: [],
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	comments: [],
});
