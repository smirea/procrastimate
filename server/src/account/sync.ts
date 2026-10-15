import { createClock, observe, SERVER_NODE } from '../../../shared/sync/hlc';
import {
	applyFixups,
	applyOps,
	entityKey,
	serverHlc,
	serverSnapshot,
	type ServerEntity,
	type ServerState,
} from '../../../shared/sync/merge';
import {
	SYNC_PAGE_SIZE,
	type Change,
	type Op,
	type SyncRequest,
	type SyncResponse,
} from '../../../shared/sync/protocol';
import { SERVER_ACTOR } from '../../../shared/values';
import type { AccountStore, LogRow } from './store';

/**
 * The stored rows as the sync core's state. The server's clock is not stored: it only has to stay ahead of every
 * field clock, so it is rebuilt from them, and `tick` keeps it ahead of the wall time.
 */
export function loadState(store: AccountStore): ServerState {
	const entities = new Map<string, ServerEntity>();
	let clock = createClock(SERVER_NODE);
	for (const entity of store.entities()) {
		entities.set(entityKey(entity.kind, entity.id), entity);
		for (const hlc of Object.values(entity.clocks)) clock = observe(clock, hlc);
	}
	return { entities, clock };
}

/** The live synced state, as a client would see it. */
export const accountSnapshot = (store: AccountStore) => serverSnapshot(loadState(store));

/**
 * Applies ops and the fixups they need, then writes the entities that changed and every log entry. The ops' rows
 * name `actor`, the user id that sent them, and the fixups' rows name the server.
 */
export function push(store: AccountStore, before: ServerState, ops: readonly Op[], now: number, actor: string) {
	const ctx = { now, isApplied: (opId: string) => store.hasOp(opId) };
	const applied = applyOps(before, ops, ctx);
	const fixed = applyFixups(applied.state, ctx);
	for (const [key, entity] of fixed.state.entities) {
		if (before.entities.get(key) !== entity) store.putEntity(entity);
	}
	for (const entry of applied.log) store.appendLog({ ...entry, actor, at: now });
	for (const entry of fixed.log) store.appendLog({ ...entry, actor: SERVER_ACTOR, at: now });
	return { state: fixed.state, acked: applied.acked };
}

/** Who wrote a row and when stay on the server; activity reads them, clients never apply them. */
function asChange(row: LogRow): Change {
	const { actor: _, at: __, ...change } = row;
	return change as Change;
}

export function sync(store: AccountStore, request: SyncRequest, now: number, actor: string): SyncResponse {
	return store.transaction(() => {
		if (request.reset) {
			store.clearTaskData();
			store.setEpoch(store.epoch() + 1);
		}
		const epoch = store.epoch();
		// A client that missed a wipe must not upload the copy that was deleted.
		if (!request.reset && request.epoch !== epoch) {
			const state = loadState(store);
			return {
				acked: [],
				snapshot: serverSnapshot(state),
				cursor: store.lastSeq(),
				hlc: serverHlc(state),
				epoch,
			};
		}
		// A cursor past the end means the log was cleared, as after a wipe or a restarted dev server.
		const restarted = request.cursor > store.lastSeq();
		const pushed = push(store, loadState(store), request.ops, now, actor);

		const head = store.lastSeq();
		const hlc = serverHlc(pushed.state);
		if (request.reset || request.cursor === 0 || restarted) {
			return { acked: pushed.acked, snapshot: serverSnapshot(pushed.state), cursor: head, hlc, epoch };
		}
		const changes = store.logAfter(request.cursor, SYNC_PAGE_SIZE).map(asChange);
		const cursor = changes.at(-1)?.seq ?? request.cursor;
		// Before the last page, an op is acked only with its row, or the client would drop it from its outbox and
		// apply older rows without it. The retry dedupes, and the last page acks everything.
		const paged = new Set(changes.map(change => change.opId));
		const acked = cursor === head ? pushed.acked : pushed.acked.filter(opId => paged.has(opId));
		return { acked, changes, cursor, hlc, epoch };
	});
}
