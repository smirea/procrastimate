import { compareIds } from './order.ts';
import { DEFAULT_SETTINGS, FIELDS_SCHEMAS, SETTINGS_ID, type Kind, type Settings, type Snapshot } from './model.ts';

export type Fields = Record<string, unknown>;

export type Entity = { id: string } & Fields;

export const emptySnapshot = (): Snapshot => ({
	tasks: [],
	projects: [],
	sections: [],
	labels: [],
	comments: [],
	reads: [],
	settings: { ...DEFAULT_SETTINGS },
});

/** Oldest first, then by id. */
export const byCreation = (a: { createdAt: number; id: string }, b: { createdAt: number; id: string }) =>
	a.createdAt - b.createdAt || compareIds(a.id, b.id);

export const byId = (a: { id: string }, b: { id: string }) => compareIds(a.id, b.id);

export function sortSnapshot(snapshot: Snapshot): Snapshot {
	return {
		tasks: snapshot.tasks.toSorted(byCreation),
		projects: snapshot.projects.toSorted(byCreation),
		sections: snapshot.sections.toSorted(byCreation),
		labels: snapshot.labels.toSorted(byCreation),
		comments: snapshot.comments.toSorted(byCreation),
		reads: snapshot.reads.toSorted(byId),
		settings: snapshot.settings,
	};
}

/** The list each kind of entity lives in; settings are the one row that is not a list. */
const LIST_OF = {
	task: 'tasks',
	project: 'projects',
	section: 'sections',
	label: 'labels',
	comment: 'comments',
	read: 'reads',
} as const satisfies Record<Exclude<Kind, 'settings'>, keyof Snapshot>;

export function entitiesOf(snapshot: Snapshot, kind: Kind): readonly Entity[] {
	if (kind === 'settings') return [{ id: SETTINGS_ID, ...snapshot.settings }];
	return snapshot[LIST_OF[kind]];
}

export function withEntities(snapshot: Snapshot, kind: Kind, entities: readonly Entity[]): Snapshot {
	if (kind === 'settings') {
		const { id: _, ...settings } = entities[0] ?? { id: SETTINGS_ID, ...DEFAULT_SETTINGS };
		return { ...snapshot, settings: settings as Settings };
	}
	return { ...snapshot, [LIST_OF[kind]]: entities };
}

/** Every synced field of an entity, with an absent `sourceKey` as `null`. */
export function fieldsOf(kind: Kind, entity: Entity): Fields {
	const fields: Fields = {};
	for (const name of Object.keys(FIELDS_SCHEMAS[kind].shape)) fields[name] = entity[name] ?? null;
	return fields;
}

/** An entity from a row's fields, or null when they do not parse. A `null` `sourceKey` is dropped. */
export function entityFrom(kind: Kind, id: string, fields: Fields): Entity | null {
	const parsed = FIELDS_SCHEMAS[kind].safeParse(fields);
	if (!parsed.success) return null;
	const entity: Entity = { id, ...parsed.data };
	if (entity.sourceKey === null) delete entity.sourceKey;
	return entity;
}
