import { UpdateType, type AbstractPowerSyncDatabase, type PowerSyncBackendConnector } from '@powersync/web';
import { getTableColumns } from 'drizzle-orm';
import { untrack } from 'svelte';
import type { Kind } from 'shared/model.ts';
import { entitiesOf } from 'shared/snapshot.ts';
import { coalesce, KIND_OF, rejectionNotice, TABLE_OF, type RowOp, type SyncedTable } from 'shared/rows.ts';
import { api, isUnauthorized } from './api.ts';
import { powerSync } from './database.ts';
import { databaseId } from './device.ts';
import { localTables } from './generated/tables.ts';
import { images } from './images/images.svelte.ts';
import { session } from './session.svelte.ts';
import { store } from './store.svelte.ts';
import { reportWarning } from './sentry.ts';
import { toasts } from './ui.svelte.ts';

const OPS: Record<UpdateType, RowOp> = {
	[UpdateType.PUT]: 'put',
	[UpdateType.PATCH]: 'patch',
	[UpdateType.DELETE]: 'delete',
};
/** Short enough that an edit reaches another device within about a second, long enough to fold a burst of keys. */
const UPLOAD_THROTTLE = 100;
/** A failed upload or a dropped stream tries again this soon, as on iOS. */
const RETRY_DELAY = 2000;
/**
 * The store writes a command in one transaction, and PowerSync's default of 100 would split a big one, such as an
 * import or deleting everything, so another device could see half a command for a moment.
 */
const UPLOAD_BATCH = 1000;
const SETTLE_TIMEOUT = 10_000;

/**
 * Every column of each table as null. PowerSync's put leaves out the columns that are null, and the server reads a
 * put as the whole row, so the upload names them.
 */
const NULLS = Object.fromEntries(
	Object.entries(localTables).map(([table, columns]) => [
		table,
		Object.fromEntries(
			Object.values(getTableColumns(columns))
				.filter(column => column.name !== 'id')
				.map(column => [column.name, null]),
		),
	]),
) as Record<string, Record<string, null>>;

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const connector: PowerSyncBackendConnector = {
	/** Null signs the user out, which stops sync; a thrown error is a network failure PowerSync retries. */
	async fetchCredentials() {
		try {
			const { token, endpoint } = await api.sync.token();
			// The server names the endpoint from the request, which behind a proxy can be its own origin. The browser only
			// ever talks to the page's.
			return { token, endpoint: new URL(new URL(endpoint).pathname, location.origin).href };
		} catch (error) {
			if (!isUnauthorized(error)) throw error;
			session.clear();
			return null;
		}
	},

	/**
	 * Sends one batch of queued writes, folded to one write per row, each named by this database and its queue id so
	 * a retried batch logs nothing twice. The image bytes the batch names go first: an entry exists only after its
	 * image was queued, so draining the image queue after reading the batch covers it. Throwing leaves the batch
	 * queued for PowerSync's next try.
	 */
	async uploadData(database: AbstractPowerSyncDatabase) {
		const batch = await database.getCrudBatch(UPLOAD_BATCH);
		if (!batch) return;
		await images.upload();
		const local = databaseId();
		// Only the server writes `access`, so an entry for a table the client does not write is dropped: thrown, it would
		// stall every upload behind it.
		const entries = batch.crud.filter(entry => {
			if (entry.table in KIND_OF) return true;
			reportWarning('Dropped a local write to a table the server owns', {
				entry: `${entry.op} ${entry.table} ${entry.id}`,
			});
			return false;
		});
		const writes = coalesce(
			entries.map(entry => ({
				op: OPS[entry.op],
				kind: KIND_OF[entry.table as SyncedTable],
				id: entry.id,
				opId: `${local}:${entry.clientId}`,
				...(entry.opData ? { values: entry.opData } : {}),
			})),
		).map(({ kind, ...write }) => {
			const table = TABLE_OF[kind];
			return { ...write, table, ...(write.op === 'put' ? { values: { ...NULLS[table], ...write.values } } : {}) };
		});
		let rejected;
		try {
			({ rejected } = await api.sync.upload({ writes }));
		} catch (error) {
			if (isUnauthorized(error)) session.clear();
			throw error;
		}
		if (rejected.length) {
			reportWarning('The server refused writes', {
				rejected: rejected.map(({ table, id, reason }) => `${table} ${id}: ${reason}`).join('\n'),
			});
		}
		const notice = rejectionNotice(
			{ ...viewOf(), reads: [], settings: store.settings },
			rejected.map(({ table, id }) => ({ kind: KIND_OF[table as SyncedTable], id })),
		);
		if (notice) toasts.show(notice);
		await batch.complete();
	},
};

/** The merged view, so a refused edit to a shared task is named too. */
const viewOf = () => ({
	tasks: store.tasks,
	projects: store.projects,
	sections: store.sections,
	labels: store.labels,
	comments: store.comments,
});

/** An empty search lists everyone the user shared with, the owners sharing with them, and their AI accounts. */
async function refreshPeople() {
	const [me, people] = await Promise.all([
		api.me().catch(() => null),
		api.people.search({ query: { q: '' } }).catch(() => null),
	]);
	store.rememberPeople([...(me ? [me] : []), ...(people?.people ?? [])]);
}

export function startSync(userId: string): () => void {
	let stopped = false;
	void store.open(userId).then(() => {
		if (!stopped)
			return powerSync.connect(connector, { crudUploadThrottleMs: UPLOAD_THROTTLE, retryDelayMs: RETRY_DELAY });
	});
	void refreshPeople();
	const asked = new Set<string>();
	const stopEffects = $effect.root(() => {
		$effect(() => {
			if (store.loaded) untrack(() => store.noteTimeZone(zone()));
		});
		// A space whose owner this device has not met yet needs their name for its byline.
		$effect(() => {
			const unknown = Object.keys(store.spaces).filter(owner => !store.person(owner) && !asked.has(owner));
			if (!unknown.length) return;
			for (const owner of unknown) asked.add(owner);
			untrack(() => void refreshPeople());
		});
	});
	return () => {
		stopped = true;
		stopEffects();
		void powerSync.disconnect();
	};
}

/**
 * Resolves once every write so far has reached the server, or after a while when it cannot be reached, for a request
 * that needs the server to know what this device made, such as sharing a new project.
 */
export async function settled(): Promise<void> {
	await store.written();
	const deadline = Date.now() + SETTLE_TIMEOUT;
	while ((await powerSync.getNextCrudTransaction()) && Date.now() < deadline) {
		await new Promise<void>(resolve => {
			const timer = setTimeout(done, deadline - Date.now());
			const dispose = powerSync.registerListener({ statusChanged: done });
			function done() {
				clearTimeout(timer);
				dispose();
				resolve();
			}
		});
	}
}

/** Read by the end-to-end specs. A store that has not read the database yet still owes the time zone it notes on loading, so it counts as pending. */
async function pending(): Promise<number> {
	if (!store.loaded) return 1;
	await store.written();
	const queued = (await powerSync.getCrudBatch(Number.MAX_SAFE_INTEGER))?.crud.length ?? 0;
	return queued + (store.holdsSettings ? 1 : 0);
}

if (typeof window !== 'undefined') {
	Object.assign(window, {
		procrastimate: {
			pending,
			reads: () => ({ ...store.readStats }),
			taskId: (title: string) => store.tasks.find(task => task.title === title)?.id,
			entity: (kind: Kind, id: string) =>
				entitiesOf({ ...viewOf(), reads: [], settings: store.settings }, kind).find(e => e.id === id),
		},
	});
}
