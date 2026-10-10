import { newId } from '../id.ts';
import { formatHlc, tick, type Clock } from './hlc.ts';
import { KINDS, type Op, type Patch, type Snapshot } from './protocol.ts';
import { entitiesOf, fieldsOf, type Fields } from './snapshot.ts';

export function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const aKeys = Object.keys(a).filter(k => (a as Fields)[k] !== undefined);
	const bKeys = Object.keys(b).filter(k => (b as Fields)[k] !== undefined);
	return aKeys.length === bKeys.length && aKeys.every(k => sameValue((a as Fields)[k], (b as Fields)[k]));
}

/**
 * One patch per entity that differs, field by field. An entity that appears, whether new or restored by
 * undo, carries `deleted: false` and all its fields. One that disappears becomes `deleted: true`.
 * Projects and labels come before the tasks that point at them.
 */
export function diff(before: Snapshot, after: Snapshot): Patch[] {
	const patches: Patch[] = [];
	for (const kind of KINDS) {
		const previous = new Map(entitiesOf(before, kind).map(e => [e.id, e]));
		const current = entitiesOf(after, kind);
		for (const entity of current) {
			const next = fieldsOf(kind, entity);
			const old = previous.get(entity.id);
			if (!old) {
				patches.push({ kind, id: entity.id, fields: { deleted: false, ...next } } as Patch);
				continue;
			}
			const prior = fieldsOf(kind, old);
			const changed = Object.fromEntries(
				Object.entries(next).filter(([name, value]) => !sameValue(prior[name], value)),
			);
			if (Object.keys(changed).length) patches.push({ kind, id: entity.id, fields: changed } as Patch);
		}
		const kept = new Set(current.map(e => e.id));
		for (const id of previous.keys()) if (!kept.has(id)) patches.push({ kind, id, fields: { deleted: true } });
	}
	return patches;
}

/** Gives each patch an op id and the next clock, in order. */
export function stamp(
	patches: readonly Patch[],
	clock: Clock,
	now: number,
	nextOpId: () => string = newId,
): { ops: Op[]; clock: Clock } {
	const ops: Op[] = [];
	for (const patch of patches) {
		clock = tick(clock, now);
		ops.push({ ...patch, opId: nextOpId(), hlc: formatHlc(clock) });
	}
	return { ops, clock };
}
