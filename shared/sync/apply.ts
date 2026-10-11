import { newId } from '../id.ts';
import { createClock, observe, type Clock } from './hlc.ts';
import { diff, stamp } from './diff.ts';
import type { Change, Op, Patch, Snapshot, SyncResponse } from './protocol.ts';
import { emptySnapshot, entitiesOf, entityFrom, fieldsOf, sortSnapshot, withEntities } from './snapshot.ts';

/** A client's sync state, stored next to its snapshot. `epoch` is the wipe generation it last applied. */
export type ClientSync = { cursor: number; outbox: Op[]; clock: Clock; epoch: number };

/**
 * Writes one patch's fields onto the snapshot without clocks. A patch with only some fields for an entity
 * the snapshot lacks is skipped, since the server sends every field when an entity appears.
 */
export function applyPatch(snapshot: Snapshot, { kind, id, fields }: Pick<Patch, 'kind' | 'id' | 'fields'>): Snapshot {
	const { deleted, ...values } = fields as Record<string, unknown>;
	const entities = entitiesOf(snapshot, kind);
	const index = entities.findIndex(e => e.id === id);
	if (deleted === true) {
		if (kind === 'settings' || index === -1) return snapshot;
		return withEntities(snapshot, kind, entities.toSpliced(index, 1));
	}
	const existing = entities[index];
	const entity = entityFrom(kind, id, existing ? { ...fieldsOf(kind, existing), ...values } : values);
	if (!entity) return snapshot;
	return withEntities(snapshot, kind, index === -1 ? [...entities, entity] : entities.with(index, entity));
}

const applyAll = (snapshot: Snapshot, patches: readonly Pick<Patch, 'kind' | 'id' | 'fields'>[]) =>
	sortSnapshot(patches.reduce(applyPatch, snapshot));

/** Applies the server's log rows in order. */
export const applyChanges = (snapshot: Snapshot, changes: readonly Change[]) => applyAll(snapshot, changes);

/** Reapplies ops the server has not acknowledged, so local edits stay visible until the server answers. */
export const replayOutbox = (snapshot: Snapshot, outbox: readonly Op[]) => applyAll(snapshot, outbox);

/** A device's first sync uploads its whole snapshot with cursor `0`, so two devices' data add up. */
export function startSync(
	snapshot: Snapshot,
	deviceId: string,
	now: number,
	nextOpId: () => string = newId,
): ClientSync {
	return commit(
		{ cursor: 0, outbox: [], clock: createClock(deviceId), epoch: 0 },
		emptySnapshot(),
		snapshot,
		now,
		nextOpId,
	);
}

/** Turns one command's before and after snapshots into ops at the end of the outbox. */
export function commit(
	sync: ClientSync,
	before: Snapshot,
	after: Snapshot,
	now: number,
	nextOpId: () => string = newId,
): ClientSync {
	const { ops, clock } = stamp(diff(before, after), sync.clock, now, nextOpId);
	return { ...sync, outbox: [...sync.outbox, ...ops], clock };
}

/**
 * Drops the acknowledged ops, takes the server's state (its snapshot, or the local one with its changes
 * applied), then replays what is still in the outbox on top.
 */
export function applyResponse(
	snapshot: Snapshot,
	sync: ClientSync,
	response: SyncResponse,
	options?: { sentReset?: boolean },
): { snapshot: Snapshot; sync: ClientSync } {
	const epochChanged = response.epoch !== sync.epoch;
	const acked = new Set(response.acked);
	// A wipe on another device drops edits that were still waiting here, so they cannot recreate what was deleted.
	// The device that sent `reset` keeps ops the server has not acked yet and replays them onto the wiped snapshot.
	const outbox = epochChanged && !options?.sentReset ? [] : sync.outbox.filter(op => !acked.has(op.opId));
	const base = 'snapshot' in response ? sortSnapshot(response.snapshot) : applyChanges(snapshot, response.changes);
	return {
		snapshot: replayOutbox(base, outbox),
		sync: { cursor: response.cursor, outbox, clock: observe(sync.clock, response.hlc), epoch: response.epoch },
	};
}
