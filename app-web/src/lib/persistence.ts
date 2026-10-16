import { emptySnapshot, parseSnapshot, type Snapshot } from 'shared/snapshot.ts';
import { opSchema } from 'shared/sync/protocol.ts';

export const STORAGE_KEY = 'procrastimate';

/**
 * One stored op that no longer validates would otherwise fail the whole document and wipe it. It is dropped instead,
 * and cursor 0 makes the next sync take the server's snapshot, so its entity goes back to the server's value.
 */
export function dropInvalidOps(document: unknown): unknown {
	const sync = (document as { sync?: { outbox?: unknown } } | null)?.sync;
	if (!sync || !Array.isArray(sync.outbox)) return document;
	const outbox = sync.outbox.filter(op => opSchema.safeParse(op).success);
	if (outbox.length === sync.outbox.length) return document;
	return { ...(document as object), sync: { ...sync, outbox, cursor: 0 } };
}

export function loadSnapshot(now: number): Snapshot {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return emptySnapshot(now);
	try {
		return parseSnapshot(dropInvalidOps(JSON.parse(raw)), now);
	} catch {
		return emptySnapshot(now);
	}
}

export function saveSnapshot(snapshot: Snapshot) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}
