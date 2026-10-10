import type { Label, Project, Task } from '../task.ts';
import { DEFAULT_SETTINGS, FIELDS_SCHEMAS, SETTINGS_ID, type Kind, type Settings, type Snapshot } from './protocol.ts';

/** Field values keyed by name, the shape ops, changes, and the server's rows carry. */
export type Fields = Record<string, unknown>;

export type Entity = { id: string } & Fields;

export const emptySnapshot = (): Snapshot => ({
	tasks: [],
	projects: [],
	labels: [],
	settings: { ...DEFAULT_SETTINGS },
});

/** Oldest first, then by id, so every replica lists the same entities in the same order. */
export const byCreation = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
	a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function sortSnapshot(snapshot: Snapshot): Snapshot {
	return {
		tasks: snapshot.tasks.toSorted(byCreation),
		projects: snapshot.projects.toSorted(byCreation),
		labels: snapshot.labels.toSorted(byCreation),
		settings: snapshot.settings,
	};
}

export function entitiesOf(snapshot: Snapshot, kind: Kind): readonly Entity[] {
	switch (kind) {
		case 'task':
			return snapshot.tasks;
		case 'project':
			return snapshot.projects;
		case 'label':
			return snapshot.labels;
		case 'settings':
			return [{ id: SETTINGS_ID, ...snapshot.settings }];
		default: {
			const never: never = kind;
			return never;
		}
	}
}

export function withEntities(snapshot: Snapshot, kind: Kind, entities: readonly Entity[]): Snapshot {
	switch (kind) {
		case 'task':
			return { ...snapshot, tasks: entities as unknown as Task[] };
		case 'project':
			return { ...snapshot, projects: entities as unknown as Project[] };
		case 'label':
			return { ...snapshot, labels: entities as unknown as Label[] };
		case 'settings': {
			const { id: _, ...settings } = entities[0] ?? { id: SETTINGS_ID, ...DEFAULT_SETTINGS };
			return { ...snapshot, settings: settings as Settings };
		}
		default: {
			const never: never = kind;
			return never;
		}
	}
}

/** Every synced field of an entity, with an absent `sourceKey` as `null`. */
export function fieldsOf(kind: Kind, entity: Entity): Fields {
	const fields: Fields = {};
	for (const name of Object.keys(FIELDS_SCHEMAS[kind].shape)) fields[name] = entity[name] ?? null;
	return fields;
}

/** Builds an entity from a full set of fields, or null when some are missing or invalid. */
export function entityFrom(kind: Kind, id: string, fields: Fields): Entity | null {
	const parsed = FIELDS_SCHEMAS[kind].safeParse(fields);
	if (!parsed.success) return null;
	const entity: Entity = { id, ...parsed.data };
	if (entity.sourceKey === null) delete entity.sourceKey;
	return entity;
}
