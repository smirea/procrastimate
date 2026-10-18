import { resolveDangling } from 'shared/dangling.ts';
import { DEFAULT_SETTINGS, KINDS, SETTINGS_ID, type Settings, type Snapshot } from 'shared/model.ts';
import type { Person } from 'shared/sharing.ts';
import { entityFrom, sortSnapshot, withEntities, type Entity } from 'shared/snapshot.ts';
import { projectsInOrder, sortTasks, type NewTask, type StoreData } from 'shared/store.ts';
import type { AccessRow, Rows } from './database.ts';

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
	access: readonly AccessRow[];
};
export type Spaces = Readonly<Record<string, SharedSpace>>;

/** `settings` is null until the row exists. */
export type Grouped = { own: StoreData; settings: Settings | null; spaces: Spaces };

export const emptyData = (): StoreData => ({
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	comments: [],
	reads: [],
});

/**
 * A row that does not parse is left out rather than failing the whole load, and a reference to a row that is gone
 * reads as empty (`resolveDangling`). Read markers and settings only ever sync for their owner.
 */
export function group(rows: Rows, me: string): Grouped {
	const empty = (): Snapshot => ({ ...emptyData(), settings: DEFAULT_SETTINGS });
	const snapshots = new Map<string, Snapshot>();
	const of = (owner: string) => snapshots.get(owner) ?? snapshots.set(owner, empty()).get(owner)!;
	for (const kind of KINDS) {
		const byOwner = Map.groupBy(rows[kind], row => row.userId);
		for (const [owner, list] of byOwner) {
			if (owner !== me && (kind === 'read' || kind === 'settings')) continue;
			const entities = list.map(row => entityFrom(kind, row.id, row)).filter((e): e is Entity => e !== null);
			if (kind === 'settings' && !entities.some(e => e.id === SETTINGS_ID)) continue;
			snapshots.set(owner, withEntities(of(owner), kind, entities));
		}
	}
	const accessByOwner = Map.groupBy(rows.access, row => row.owner);
	for (const owner of accessByOwner.keys()) of(owner);
	const { settings, ...own } = sortSnapshot(resolveDangling(snapshots.get(me) ?? empty()));
	const hasSettings = rows.settings.some(row => row.userId === me && row.id === SETTINGS_ID);
	snapshots.delete(me);
	const spaces: Record<string, SharedSpace> = {};
	for (const [owner, snapshot] of snapshots) {
		const { settings: _, ...data } = sortSnapshot(resolveDangling(snapshot));
		const access = (accessByOwner.get(owner) ?? []).toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		const readOnly = new Set(access.filter(row => row.kind === 'task' && row.role === 'view').map(row => row.entityId));
		spaces[owner] = { owner, data: { ...data, reads: [] }, readOnly, access };
	}
	return { own, settings: hasSettings ? settings : null, spaces };
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
