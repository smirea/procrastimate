import { newId } from '../id.ts';
import { diff } from './diff.ts';
import { fixups } from './fixups.ts';
import {
	compareHlc,
	createClock,
	formatHlc,
	observe,
	parseHlc,
	SERVER_NODE,
	tick,
	type Clock,
	type Hlc,
} from './hlc.ts';
import { DEFAULT_SETTINGS, KINDS, type Kind, type Op, type Patch, type Snapshot } from './protocol.ts';
import { emptySnapshot, entityFrom, sortSnapshot, withEntities, type Entity, type Fields } from './snapshot.ts';

/**
 * The server's half of sync. Every field of every entity is last-writer-wins by its own clock, and
 * `deleted` is a field like the others, so a deleted entity stays as a tombstone that later edits
 * cannot revive. Only `deleted: false` with a newer clock brings it back.
 */

/** One row of the `entities` table: the current values and one clock per field. */
export type ServerEntity = { kind: Kind; id: string; data: Fields; clocks: Record<string, Hlc> };

export type ServerState = { entities: ReadonlyMap<string, ServerEntity>; clock: Clock };

/** A log row before it gets its sequence number: the fields of one op that won. */
export type LogEntry = Patch & { opId: string };

export type MergeContext = {
	now: number;
	/** Whether an op id is already in the log, so a retried push never applies twice. */
	isApplied: (opId: string) => boolean;
	nextOpId?: () => string;
};

/** How far ahead of the server's clock a device's clock may run before the server overrides it. */
export const MAX_CLOCK_LEAD = 60_000;

export const entityKey = (kind: Kind, id: string) => `${kind}:${id}`;

export const createServerState = (): ServerState => ({ entities: new Map(), clock: createClock(SERVER_NODE) });

/** The clock the server returns, which a client never issues below. */
export const serverHlc = (state: ServerState) => formatHlc(state.clock);

const isLive = (kind: Kind, data: Fields | undefined) => kind === 'settings' || data?.deleted === false;

/**
 * Writes the fields that beat their stored clocks and returns them as the op's log entry. While an entity is not live only `deleted` can change,
 * so edits to a tombstone are dropped. When it turns live, the row carries all its fields, so a client that never had it can build it.
 */
function write(entities: Map<string, ServerEntity>, { kind, id, fields, opId }: LogEntry, hlc: Hlc): LogEntry {
	const key = entityKey(kind, id);
	const current = entities.get(key);
	const data: Fields = { ...current?.data };
	const clocks = { ...current?.clocks };
	const won: Fields = {};
	const take = (name: string, value: unknown) => {
		const clock = clocks[name];
		if (value === undefined || (clock !== undefined && compareHlc(hlc, clock) <= 0)) return;
		data[name] = value;
		clocks[name] = hlc;
		won[name] = value;
	};
	const { deleted, ...values } = fields as Fields;
	if (kind !== 'settings') take('deleted', deleted);
	if (isLive(kind, data)) for (const [name, value] of Object.entries(values)) take(name, value);
	if (!Object.keys(won).length) return { kind, id, opId, fields: {} };
	entities.set(key, { kind, id, data, clocks });
	const appeared = !isLive(kind, current?.data) && isLive(kind, data);
	return { kind, id, opId, fields: appeared ? { ...data } : won } as LogEntry;
}

/**
 * Applies a device's ops in order and returns the ids to acknowledge, including ones already applied,
 * and one log entry per newly applied op, with no fields when it won none. Logging every op is what lets
 * a retry be skipped: a retried op with a clamped clock would otherwise get a newer clock and could win.
 * A clock more than a minute ahead of `now` is replaced by the server's, keeping the device as the tie-break.
 */
export function applyOps(
	state: ServerState,
	ops: readonly Op[],
	ctx: MergeContext,
): { state: ServerState; acked: string[]; log: LogEntry[] } {
	const entities = new Map(state.entities);
	let clock = state.clock;
	const acked: string[] = [];
	const log: LogEntry[] = [];
	const seen = new Set<string>();
	for (const op of ops) {
		acked.push(op.opId);
		if (seen.has(op.opId) || ctx.isApplied(op.opId)) continue;
		seen.add(op.opId);
		let hlc = op.hlc;
		const sent = parseHlc(hlc);
		if (sent.wall > ctx.now + MAX_CLOCK_LEAD) {
			clock = tick(clock, ctx.now);
			hlc = formatHlc({ ...clock, node: sent.node });
		} else {
			clock = observe(clock, hlc);
		}
		const { hlc: _, ...entry } = op;
		log.push(write(entities, entry as LogEntry, hlc));
	}
	return { state: { entities, clock }, acked, log };
}

/** The live entities, as a client holds them. */
export function serverSnapshot(state: ServerState): Snapshot {
	const live = new Map<Kind, Entity[]>(KINDS.map(kind => [kind, []]));
	for (const { kind, id, data } of state.entities.values()) {
		if (!isLive(kind, data)) continue;
		const { deleted: _, ...fields } = data;
		const entity = entityFrom(kind, id, kind === 'settings' ? { ...DEFAULT_SETTINGS, ...fields } : fields);
		if (entity) live.get(kind)!.push(entity);
	}
	return sortSnapshot(KINDS.reduce((snapshot, kind) => withEntities(snapshot, kind, live.get(kind)!), emptySnapshot()));
}

/** Runs `fixups` on the live state and writes each repair as a server op with a clock newer than any seen. */
export function applyFixups(state: ServerState, ctx: MergeContext): { state: ServerState; log: LogEntry[] } {
	const before = serverSnapshot(state);
	const entities = new Map(state.entities);
	let clock = state.clock;
	const log: LogEntry[] = [];
	for (const patch of diff(before, fixups(before))) {
		clock = tick(clock, ctx.now);
		log.push(write(entities, { ...patch, opId: (ctx.nextOpId ?? newId)() }, formatHlc(clock)));
	}
	return { state: { entities, clock }, log };
}

/** One push: the device's ops, then the repairs they call for. */
export function applyPush(state: ServerState, ops: readonly Op[], ctx: MergeContext) {
	const applied = applyOps(state, ops, ctx);
	const fixed = applyFixups(applied.state, ctx);
	return { state: fixed.state, acked: applied.acked, log: [...applied.log, ...fixed.log] };
}
