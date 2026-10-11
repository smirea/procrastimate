import type { z } from 'zod';
import { createClock, observe, SERVER_NODE } from '../../../shared/sync/hlc';
import {
	applyPush,
	entityKey,
	serverHlc,
	serverSnapshot,
	type ServerEntity,
	type ServerState,
} from '../../../shared/sync/merge';
import { syncRequestSchema, type Change, type SyncResponse } from '../../../shared/sync/protocol';
import { authenticate, type AccountRoute } from '../auth';
import type { AccountStore } from './store';

/** The most log rows one response carries. A client that gets a full page syncs again right away. */
export const SYNC_PAGE_SIZE = 1000;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * The stored rows as the sync core's state. The server's clock is not stored: it only has to stay ahead of every
 * field clock, so it is rebuilt from them, and `tick` keeps it ahead of the wall time.
 */
function loadState(store: AccountStore): ServerState {
	const entities = new Map<string, ServerEntity>();
	let clock = createClock(SERVER_NODE);
	for (const row of store.entities()) {
		const entity = row as ServerEntity;
		entities.set(entityKey(entity.kind, entity.id), entity);
		for (const hlc of Object.values(entity.clocks)) clock = observe(clock, hlc);
	}
	return { entities, clock };
}

/** One push, all in one transaction: apply, log every op, then answer from the log or with the snapshot. */
export function sync(store: AccountStore, request: z.infer<typeof syncRequestSchema>, now: number): SyncResponse {
	return store.transaction(() => {
		// A cursor past the end means the log was reset, as on a restarted dev server, so the client starts over.
		const reset = request.cursor > store.lastSeq();
		const before = loadState(store);
		const pushed = applyPush(before, request.ops, { now, isApplied: opId => store.hasOp(opId) });
		for (const [key, entity] of pushed.state.entities) {
			if (before.entities.get(key) !== entity) store.putEntity(entity);
		}
		for (const entry of pushed.log) store.appendLog(entry);

		const head = store.lastSeq();
		const hlc = serverHlc(pushed.state);
		if (request.cursor === 0 || reset) {
			return { acked: pushed.acked, snapshot: serverSnapshot(pushed.state), cursor: head, hlc };
		}
		const changes = store.logAfter(request.cursor, SYNC_PAGE_SIZE) as Change[];
		const cursor = changes.at(-1)?.seq ?? request.cursor;
		// Before the last page, an op is acked only with its row, or the client would drop it from its outbox and
		// apply older rows without it. The retry dedupes, and the last page acks everything.
		const paged = new Set(changes.map(change => change.opId));
		const acked = cursor === head ? pushed.acked : pushed.acked.filter(opId => paged.has(opId));
		return { acked, changes, cursor, hlc };
	});
}

export const syncRoutes: Record<string, AccountRoute> = {
	'POST /api/sync': async (request, context) => {
		const deviceId = await authenticate(request, context);
		if (!deviceId) return fail(401, 'Not signed in');
		const body = syncRequestSchema.safeParse(await request.json().catch(() => undefined));
		if (!body.success) return fail(400, 'Invalid sync request');
		return Response.json(sync(context.store, body.data, context.now));
	},
};
