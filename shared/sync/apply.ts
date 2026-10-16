import { newId } from '../id.ts';
import { createClock, observe, type Clock } from './hlc.ts';
import { diff, stamp } from './diff.ts';
import {
	KINDS,
	type Change,
	type Op,
	type Patch,
	type Rejection,
	type Snapshot,
	type SyncResponse,
} from './protocol.ts';
import {
	emptySnapshot,
	entitiesOf,
	entityFrom,
	fieldsOf,
	sortSnapshot,
	withEntities,
	type Fields,
} from './snapshot.ts';

/** `seed` is set until the device's first snapshot arrives, which then queues what the local data adds to it. */
export type ClientSync = { cursor: number; outbox: Op[]; clock: Clock; epoch: number; seed: boolean };

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

export const applyChanges = (snapshot: Snapshot, changes: readonly Change[]) => applyAll(snapshot, changes);

/** Reapplies ops the server has not acknowledged, so local edits stay visible until the server answers. */
export const replayOutbox = (snapshot: Snapshot, outbox: readonly Op[]) => applyAll(snapshot, outbox);

/**
 * A device's first sync uploads none of its tasks, projects, or labels: it pulls the server's snapshot first, and
 * `seedPatches` then queues only what the server lacks. Only the settings that differ from the defaults, the
 * device's zone, go out with the first request.
 */
export function startSync(
	settings: Snapshot['settings'],
	deviceId: string,
	now: number,
	nextOpId: () => string = newId,
): ClientSync {
	return commit(
		{ cursor: 0, outbox: [], clock: createClock(deviceId), epoch: 0, seed: true },
		emptySnapshot(),
		{ ...emptySnapshot(), settings },
		now,
		nextOpId,
	);
}

/**
 * What a device's local data adds to the server's on its first sync: the entities the server lacks and the fields it
 * holds differently. Nothing the server has is removed, and its settings stay, so a new install never overwrites the
 * dictation choice another device made.
 */
export function seedPatches(server: Snapshot, local: Snapshot): Patch[] {
	const merged = KINDS.filter(kind => kind !== 'settings').reduce((snapshot, kind) => {
		const mine = entitiesOf(local, kind);
		const ids = new Set(mine.map(e => e.id));
		return withEntities(snapshot, kind, [...mine, ...entitiesOf(server, kind).filter(e => !ids.has(e.id))]);
	}, server);
	return diff(server, merged);
}

/** Turns one command's before and after snapshots into queued ops. Returns `sync` itself when nothing changed. */
export function commit(
	sync: ClientSync,
	before: Snapshot,
	after: Snapshot,
	now: number,
	nextOpId: () => string = newId,
): ClientSync {
	const patches = diff(before, after);
	if (!patches.length) return sync;
	const { ops, clock } = stamp(patches, sync.clock, now, nextOpId);
	return { ...sync, outbox: enqueue(sync.outbox, ops), clock };
}

/**
 * Adds ops to the outbox so it holds at most one value per entity field, the latest, each with the clock it was
 * written at. Typing a title therefore queues one op, however many keystrokes it took.
 *
 * - An op that carries `deleted` (a delete, or a create or undelete with every field) replaces every queued op for
 *   its entity, since each of their fields would lose to it.
 * - Any other op on an entity whose create or undelete is still queued folds into it under the new op's id and
 *   clock, because the server builds an entity only from an op that carries every field.
 * - Otherwise the op's fields leave the older ops for its entity, and an op left with none is dropped.
 *
 * An op already on its way may still change: a stripped op keeps its id, so the server applies either the original
 * or what is left, and a folded op gets a new id, so it applies even when the original already did.
 */
export function enqueue(outbox: readonly Op[], ops: readonly Op[]): Op[] {
	return ops.reduce<Op[]>(
		(queued, op) => {
			const fields = op.fields as Fields;
			const same = (other: Op) => other.kind === op.kind && other.id === op.id;
			if (fields.deleted !== undefined) return [...queued.filter(other => !same(other)), op];
			const live = queued.find(other => same(other) && (other.fields as Fields).deleted === false);
			if (live) {
				const folded = { ...live, opId: op.opId, hlc: op.hlc, fields: { ...live.fields, ...fields } } as Op;
				return queued.map(other => (other === live ? folded : other));
			}
			const stripped = queued.flatMap(other => {
				if (!same(other)) return [other];
				const rest = Object.fromEntries(Object.entries(other.fields).filter(([name]) => !(name in fields)));
				return Object.keys(rest).length ? [{ ...other, fields: rest } as Op] : [];
			});
			return [...stripped, op];
		},
		[...outbox],
	);
}

/** Splits the outbox by the server's answer: the ops still waiting, and the ones it rejected, which never apply. */
export function settle(
	outbox: readonly Op[],
	acked: readonly string[],
	rejected: readonly Rejection[],
): { outbox: Op[]; rejected: Op[] } {
	const done = new Set(acked);
	const refused = new Set(rejected.map(rejection => rejection.opId));
	return {
		outbox: outbox.filter(op => !done.has(op.opId) && !refused.has(op.opId)),
		rejected: outbox.filter(op => refused.has(op.opId)),
	};
}

function nameOf(snapshot: Snapshot, { kind, id }: Op): string | undefined {
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

/** The notice for rejected ops, named by what `snapshot` shows for their entity before the server's value replaces it. */
export function rejectionNotice(snapshot: Snapshot, rejected: readonly Op[]): string | null {
	const entities = [...new Map(rejected.map(op => [`${op.kind}:${op.id}`, op])).values()];
	if (!entities.length) return null;
	if (entities.length > 1) return `Couldn’t save changes to ${entities.length} items`;
	const name = nameOf(snapshot, entities[0]!);
	return name ? `Couldn’t save a change to “${name}”` : 'Couldn’t save a change';
}

/**
 * Drops the acknowledged and rejected ops, takes the server's state (its snapshot, or the local one with its changes
 * applied), then replays what is still in the outbox on top. A rejection always comes with the snapshot, so the
 * rejected op's entity shows the server's value again. The first snapshot a seeding device gets also queues
 * what its local data adds, so the caller syncs again when the outbox is not empty.
 */
export function applyResponse(
	snapshot: Snapshot,
	sync: ClientSync,
	response: SyncResponse,
	now: number,
	options?: { sentReset?: boolean; nextOpId?: () => string },
): { snapshot: Snapshot; sync: ClientSync; rejected: Op[] } {
	const epochChanged = response.epoch !== sync.epoch;
	const settled = settle(sync.outbox, response.acked, response.rejected);
	// A wipe on another device drops edits that were still waiting here, so they cannot recreate what was deleted.
	// The device that sent `reset` keeps ops the server has not acked yet and replays them onto the wiped snapshot.
	const kept = epochChanged && !options?.sentReset ? [] : settled.outbox;
	const base = 'snapshot' in response ? sortSnapshot(response.snapshot) : applyChanges(snapshot, response.changes);
	let clock = observe(sync.clock, response.hlc);
	let outbox = kept;
	const seeding = sync.seed && 'snapshot' in response;
	// A wipe this device never saw makes its local copy stale, so it must not upload it.
	if (seeding && (!epochChanged || options?.sentReset)) {
		const seeded = stamp(seedPatches(base, snapshot), clock, now, options?.nextOpId);
		outbox = enqueue(kept, seeded.ops);
		clock = seeded.clock;
	}
	return {
		snapshot: replayOutbox(base, outbox),
		sync: { cursor: response.cursor, outbox, clock, epoch: response.epoch, seed: sync.seed && !seeding },
		rejected: settled.rejected,
	};
}
