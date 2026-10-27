import { untrack } from 'svelte';
import type { Rejected } from 'sync-engine/core';
import type { Kind } from 'shared/model.ts';
import { entitiesOf } from 'shared/snapshot.ts';
import { KIND_OF, rejectionNotice, type SyncedTable } from 'shared/rows.ts';
import { api, isUnauthorized } from './api.ts';
import { localDatabase } from './database.ts';
import { session } from './session.svelte.ts';
import { store } from './store.svelte.ts';
import { reportError, reportWarning } from './sentry.ts';
import { toasts } from './ui.svelte.ts';
import { unsynced } from './unsynced.svelte.ts';

/**
 * The web's side of sync-engine: the database worker syncs on its own once it holds a token, 100 ms after a local
 * write, on every live head, and on its timers, and uploads queued image bytes before any writes. This module hands it
 * the session's token, takes it back on sign-out, and tells the user about writes the server refused.
 */

const SETTLE_TIMEOUT = 10_000;
/** Like the engine's own retries on the web: from 2 s, as PowerSync did, to at most the worker's cap. */
const RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 3000;

/** A refusal as the status lists it, to tell the ones already shown from new ones. */
const keyOf = ({ seq, table, id }: Rejected) => `${seq}:${table}:${id}`;

/** Every tab hears the host's status; the one the user is looking at says what was refused. */
function noticeRefusals(rejected: readonly Rejected[], shown: Set<string>) {
	const fresh = rejected.filter(entry => !shown.has(keyOf(entry)));
	for (const entry of fresh) shown.add(keyOf(entry));
	if (!fresh.length) return;
	reportWarning('The server refused writes', {
		rejected: fresh.map(({ table, id, reason }) => `${table} ${id}: ${reason}`).join('\n'),
	});
	if (document.visibilityState !== 'visible') return;
	const notice = rejectionNotice(
		{ ...viewOf(), reads: [], settings: store.settings },
		fresh.flatMap(({ table, id }) => (table in KIND_OF ? [{ kind: KIND_OF[table as SyncedTable], id }] : [])),
	);
	if (notice) toasts.show(notice);
}

/** The session's token, or null when the session is gone, which signs out. Any other failure throws. */
async function token(): Promise<string | null> {
	try {
		return (session.takeCredentials() ?? (await api.sync.token())).token;
	} catch (error) {
		if (!isUnauthorized(error)) throw error;
		session.clear();
		return null;
	}
}

/** The merged view, so a refused edit to a shared task is named too. */
const viewOf = () => ({
	tasks: store.tasks,
	projects: store.projects,
	sections: store.sections,
	labels: store.labels,
	comments: store.comments,
});

/**
 * An empty search lists everyone the user shared with, the owners sharing with them, their AI accounts, and whoever
 * made or finished a task they see.
 */
async function refreshPeople() {
	const [me, people] = await Promise.all([
		api.me().catch(() => null),
		api.people.search({ query: { q: '' } }).catch(() => null),
	]);
	store.rememberPeople([...(me ? [me] : []), ...(people?.people ?? [])]);
}

export function startSync(userId: string): () => void {
	let stopped = false;
	const shown = new Set<string>();
	// Offline or a failing server, the token fetch is tried again until it lands or sync stops.
	const connect = async (): Promise<void> => {
		for (let wait = RETRY_DELAY; !stopped; wait = Math.min(wait * 2, MAX_RETRY_DELAY)) {
			try {
				const next = await token();
				if (!stopped && next) await localDatabase.setToken(next);
				return;
			} catch (error) {
				if (navigator.onLine) reportError(error);
				await new Promise(resolve => setTimeout(resolve, wait));
			}
		}
	};
	store
		.open(userId)
		.then(() => (stopped ? undefined : connect()))
		.catch(reportError);
	void refreshPeople();
	const stopUnsynced = unsynced.start();
	const stopStatus = localDatabase.onStatus(status => {
		noticeRefusals(status.rejected, shown);
		// A 401 stops the loop until a new token: a session that is still good gets one, a gone one signs out.
		if (status.unauthorized && !stopped) connect().catch(reportError);
	});
	const asked = new Set<string>();
	const stopEffects = $effect.root(() => {
		// A space's owner, or whoever made or finished a task, names a byline, so someone this device has not met yet
		// sends it to ask.
		$effect(() => {
			const ids = new Set(Object.keys(store.spaces));
			for (const task of store.tasks) {
				if (task.createdBy) ids.add(task.createdBy);
				if (task.completedBy) ids.add(task.completedBy);
			}
			const unknown = [...ids].filter(id => !store.person(id) && !asked.has(id));
			if (!unknown.length) return;
			for (const id of unknown) asked.add(id);
			untrack(() => void refreshPeople());
		});
	});
	return () => {
		stopped = true;
		stopEffects();
		stopUnsynced();
		stopStatus();
		void localDatabase.setToken(null);
	};
}

/**
 * Resolves once every write so far has reached the server, or after a while when it cannot be reached, for a request
 * that needs the server to know what this device made, such as sharing a new project.
 */
export async function settled(): Promise<void> {
	await store.written();
	const deadline = Date.now() + SETTLE_TIMEOUT;
	while ((await localDatabase.status()).pending > 0 && Date.now() < deadline) {
		await localDatabase.sync().catch(() => new Promise(resolve => setTimeout(resolve, 200)));
	}
}

/** Read by the end-to-end specs. A store that has not read the database yet still owes the time zone it notes on loading, so it counts as pending. */
async function pending(): Promise<number> {
	if (!store.loaded) return 1;
	await store.written();
	const queued = (await localDatabase.status()).pending;
	// Read after the queue: a settings row that arrived meanwhile turns the held settings into a write still on its way.
	return queued + (store.holdsSettings || store.writing ? 1 : 0);
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
