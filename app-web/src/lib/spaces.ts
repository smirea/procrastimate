import type { Access, SpaceRows } from 'shared/local-rows.ts';
import type { Homes } from 'shared/space-routing.ts';
import { sortTasks, type StoreData } from 'shared/store.ts';

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

/** Every shared entity's owner, for `shared/space-routing.ts`. */
export function homes(spaces: Spaces): Homes {
	const map: Record<string, string> = {};
	for (const { owner, data } of Object.values(spaces)) {
		for (const entity of [...data.tasks, ...data.projects, ...data.sections, ...data.labels]) map[entity.id] = owner;
	}
	return map;
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
