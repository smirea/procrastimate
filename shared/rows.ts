import { KINDS, type Kind, type Snapshot } from './model.ts';
import { entitiesOf, entityFrom, fieldsOf, withEntities, type Fields } from './snapshot.ts';

/**
 * The bridge between the in-memory store and a database. Every store rule stays a function from one snapshot to the
 * next; `rowWrites` turns the before and after into the rows to write. Clients write them to their local PowerSync
 * database, and the server applies them to Postgres. A new entity is a `put` with every field, a changed one a
 * `patch` with only the fields that changed, and a removed one a `delete`.
 */

export const ROW_OPS = ['put', 'patch', 'delete'] as const;
export type RowOp = (typeof ROW_OPS)[number];

export type RowWrite = { op: RowOp; kind: Kind; id: string; values?: Fields };

export const TABLE_OF = {
	task: 'tasks',
	project: 'projects',
	section: 'sections',
	label: 'labels',
	comment: 'comments',
	read: 'reads',
	settings: 'settings',
} as const satisfies Record<Kind, string>;
export type SyncedTable = (typeof TABLE_OF)[Kind];
export const KIND_OF = Object.fromEntries(Object.entries(TABLE_OF).map(([kind, table]) => [table, kind])) as Record<
	SyncedTable,
	Kind
>;

export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const aKeys = Object.keys(a).filter(k => (a as Fields)[k] !== undefined);
	const bKeys = Object.keys(b).filter(k => (b as Fields)[k] !== undefined);
	return aKeys.length === bKeys.length && aKeys.every(k => sameValue((a as Fields)[k], (b as Fields)[k]));
}

/** Projects, sections, and labels come before the tasks that point at them, and tasks before their comments. */
export function rowWrites(before: Snapshot, after: Snapshot): RowWrite[] {
	const writes: RowWrite[] = [];
	for (const kind of KINDS) {
		const previous = new Map(entitiesOf(before, kind).map(e => [e.id, e]));
		const current = entitiesOf(after, kind);
		for (const entity of current) {
			const next = fieldsOf(kind, entity);
			const old = previous.get(entity.id);
			if (!old) {
				writes.push({ op: 'put', kind, id: entity.id, values: next });
				continue;
			}
			const prior = fieldsOf(kind, old);
			const changed = Object.fromEntries(
				Object.entries(next).filter(([name, value]) => !sameValue(prior[name], value)),
			);
			if (Object.keys(changed).length) writes.push({ op: 'patch', kind, id: entity.id, values: changed });
		}
		const kept = new Set(current.map(e => e.id));
		for (const id of previous.keys()) if (!kept.has(id)) writes.push({ op: 'delete', kind, id });
	}
	return writes;
}

/**
 * Folds writes to one row into one: a patch folds into the write before it, keeping that write's place, later fields
 * winning. A put or a delete replaces what came before and moves to its own place, so a row deleted and created again
 * still follows the rows it points at. A patch after a delete changes nothing.
 */
export function coalesce<T extends RowWrite>(writes: readonly T[]): T[] {
	const out: (T | null)[] = [];
	const at = new Map<string, number>();
	for (const write of writes) {
		const key = `${write.kind}:${write.id}`;
		const index = at.get(key);
		const prior = index === undefined ? null : out[index]!;
		if (prior && write.op === 'patch') {
			if (prior.op !== 'delete') out[index!] = { ...prior, values: { ...prior.values, ...write.values } };
			continue;
		}
		if (index !== undefined) out[index] = null;
		at.set(key, out.push(write) - 1);
	}
	return out.filter(write => write !== null);
}

function nameOf(snapshot: Snapshot, { kind, id }: Pick<RowWrite, 'kind' | 'id'>): string | undefined {
	switch (kind) {
		case 'task':
			return snapshot.tasks.find(task => task.id === id)?.title;
		case 'project':
			return snapshot.projects.find(project => project.id === id)?.name;
		case 'section':
			return snapshot.sections.find(section => section.id === id)?.name;
		case 'label':
			return snapshot.labels.find(label => label.id === id)?.name;
	}
}

/** The notice for writes the server refused, named by what `snapshot` shows before the server's value replaces it. */
export function rejectionNotice(snapshot: Snapshot, rejected: readonly Pick<RowWrite, 'kind' | 'id'>[]): string | null {
	const rows = [...new Map(rejected.map(write => [`${write.kind}:${write.id}`, write])).values()];
	if (!rows.length) return null;
	if (rows.length > 1) return `Couldn’t save changes to ${rows.length} items`;
	const name = nameOf(snapshot, rows[0]!);
	return name ? `Couldn’t save a change to “${name}”` : 'Couldn’t save a change';
}

export function applyWrite(snapshot: Snapshot, write: RowWrite): Snapshot {
	const entities = entitiesOf(snapshot, write.kind);
	const index = entities.findIndex(entity => entity.id === write.id);
	if (write.op === 'delete') {
		if (write.kind === 'settings' || index < 0) return snapshot;
		return withEntities(snapshot, write.kind, entities.toSpliced(index, 1));
	}
	const base = write.op === 'patch' ? entities[index] : undefined;
	if (write.op === 'patch' && !base) return snapshot;
	const entity = entityFrom(write.kind, write.id, { ...(base && fieldsOf(write.kind, base)), ...write.values });
	if (!entity) return snapshot;
	return withEntities(snapshot, write.kind, index < 0 ? [...entities, entity] : entities.toSpliced(index, 1, entity));
}
