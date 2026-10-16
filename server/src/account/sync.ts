import { admit, filterSnapshot, scopeHash, scopeOf, type Grant } from '../../../shared/scope';
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
	opSchema,
	SYNC_PAGE_SIZE,
	type Change,
	type FieldsByKind,
	type Op,
	type Rejection,
	type Snapshot,
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
 * The server's authorship stamps, which overwrite whatever a client sent: `createdBy` on a task's first appearance,
 * `completedBy` on the op that completes it (a recurring roll included, through `lastCompletedAt`), and null again
 * when it is reopened. They travel with the same clock as the fields they describe, so they win and lose together.
 */
type TaskFields = Partial<FieldsByKind['task']> & { deleted?: boolean };
type CommentFields = Partial<FieldsByKind['comment']> & { deleted?: boolean };

/**
 * A new comment's author is whoever sent it. Once a comment exists only its author may change it, and never its task
 * or creation time, so an op from anyone else on an existing comment keeps no fields.
 */
function stampComment(before: ServerState, op: Op, actor: string): Op {
	const { authorId: _, taskId, createdAt, ...fields } = op.fields as CommentFields;
	const existing = before.entities.get(entityKey('comment', op.id));
	if (!existing) return { ...op, fields: { ...fields, taskId, createdAt, authorId: actor } } as Op;
	return { ...op, fields: existing.data.authorId === actor ? fields : {} } as Op;
}

function stampAuthorship(before: ServerState, ops: readonly Op[], actor: string): Op[] {
	return ops.map(op => {
		if (op.kind === 'comment') return stampComment(before, op, actor);
		if (op.kind !== 'task') return op;
		const { createdBy: _, completedBy: __, ...fields } = op.fields as TaskFields;
		const stamped: TaskFields = { ...fields };
		if (fields.deleted === false && !before.entities.has(entityKey('task', op.id))) stamped.createdBy = actor;
		if (fields.completedAt !== undefined) stamped.completedBy = fields.completedAt === null ? null : actor;
		else if (fields.lastCompletedAt !== undefined) stamped.completedBy = actor;
		return { ...op, fields: stamped } as Op;
	});
}

/**
 * Applies ops and the fixups they need, then writes the entities that changed and every log entry. The ops' rows
 * name `actor`, the user id that sent them, and the fixups' rows name the server.
 */
export function push(store: AccountStore, before: ServerState, ops: readonly Op[], now: number, actor: string) {
	const ctx = { now, isApplied: (opId: string) => store.hasOp(opId) };
	const applied = applyOps(before, stampAuthorship(before, ops, actor), ctx);
	const fixed = applyFixups(applied.state, ctx);
	for (const [key, entity] of fixed.state.entities) {
		if (before.entities.get(key) !== entity) store.putEntity(entity);
	}
	for (const entry of applied.log) store.appendLog({ ...entry, actor, at: now });
	for (const entry of fixed.log) store.appendLog({ ...entry, actor: SERVER_ACTOR, at: now });
	return { state: fixed.state, acked: applied.acked };
}

/**
 * Parses each op of a request on its own, so one the contract refuses is rejected by itself and the rest still apply.
 * An entry without a string `opId` cannot be named in `rejected`; no client can store one, so it is skipped.
 */
export function parseOps(raw: readonly unknown[]): { ops: Op[]; rejected: Rejection[] } {
	const ops: Op[] = [];
	const rejected: Rejection[] = [];
	for (const entry of raw) {
		const parsed = opSchema.safeParse(entry);
		if (parsed.success) {
			ops.push(parsed.data);
			continue;
		}
		const opId = (entry as { opId?: unknown } | null)?.opId;
		if (typeof opId !== 'string') continue;
		const reason = parsed.error.issues.map(issue => `${issue.path.join('.') || 'op'}: ${issue.message}`).join('; ');
		rejected.push({ opId, reason: reason.slice(0, 500) });
	}
	return { ops, rejected };
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
				rejected: [],
				snapshot: serverSnapshot(state),
				cursor: store.lastSeq(),
				hlc: serverHlc(state),
				epoch,
			};
		}
		// A cursor past the end means the log was cleared, as after a wipe or a restarted dev server.
		const restarted = request.cursor > store.lastSeq();
		const { ops, rejected } = parseOps(request.ops);
		const pushed = push(store, loadState(store), ops, now, actor);

		const head = store.lastSeq();
		const hlc = serverHlc(pushed.state);
		// The snapshot puts a rejected op's entity back to what the server holds, which the log alone may never carry.
		if (request.reset || request.cursor === 0 || restarted || rejected.length) {
			return { acked: pushed.acked, rejected, snapshot: serverSnapshot(pushed.state), cursor: head, hlc, epoch };
		}
		const changes = store.logAfter(request.cursor, SYNC_PAGE_SIZE).map(asChange);
		const cursor = changes.at(-1)?.seq ?? request.cursor;
		// Before the last page, an op is acked only with its row, or the client would drop it from its outbox and
		// apply older rows without it. The retry dedupes, and the last page acks everything.
		const paged = new Set(changes.map(change => change.opId));
		const acked = cursor === head ? pushed.acked : pushed.acked.filter(opId => paged.has(opId));
		return { acked, rejected, changes, cursor, hlc, epoch };
	});
}

/** The visible snapshot of a space for a guest, with the tasks they may only read. */
export function guestView(snapshot: Snapshot, grants: readonly Grant[]) {
	const scope = scopeOf(snapshot, grants);
	const filtered = filterSnapshot(snapshot, scope);
	const readOnly = filtered.tasks.filter(task => !scope.editable.has(task.id)).map(task => task.id);
	return { scope, filtered, readOnly };
}

/**
 * A guest's sync of a shared space. The ops `admit` lets through are written as the guest; the rest are acked and
 * logged with no fields, so a retry dedupes and nothing is written. A guest never pages the log: the answer is no
 * changes when the filtered snapshot still hashes to what the guest last applied, else the whole filtered snapshot.
 * A guest's `reset` is ignored.
 */
export function guestSync(
	store: AccountStore,
	request: SyncRequest,
	now: number,
	actor: string,
	grants: readonly Grant[],
): SyncResponse {
	return store.transaction(() => {
		const epoch = store.epoch();
		const before = loadState(store);
		const { ops, rejected } = parseOps(request.ops);
		const { admitted, refused } = admit(serverSnapshot(before), grants, ops, actor);
		const pushed = push(store, before, admitted, now, actor);
		for (const op of refused) {
			if (store.hasOp(op.opId)) continue;
			store.appendLog({ opId: op.opId, kind: op.kind, id: op.id, fields: {}, actor, at: now });
		}
		const acked = ops.map(op => op.opId);
		const { filtered, readOnly } = guestView(serverSnapshot(pushed.state), grants);
		const targets = grants.map(({ targetKind, targetId }) => ({ kind: targetKind, id: targetId }));
		// A new share or a changed role can leave the visible tasks as they were, so both are part of the hash.
		const scope = scopeHash({ filtered, readOnly, targets });
		const base = { acked, rejected, cursor: store.lastSeq(), hlc: serverHlc(pushed.state), epoch, scope };
		if (request.epoch === epoch && request.scope === scope && !rejected.length) return { ...base, changes: [] };
		return { ...base, snapshot: filtered, readOnly, targets };
	});
}
