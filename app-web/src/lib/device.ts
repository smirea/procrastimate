import { z } from 'zod';
import type { RowWrite } from 'shared/rows.ts';
import { personSchema, type Person } from 'shared/sharing.ts';

/** Every key this browser's `localStorage` and `sessionStorage` hold, so tests and the boot script read the same ones. */
export const DEVICE_KEYS = {
	/** The account this browser's database was last opened for, so other tabs reload when it changes. */
	owner: 'procrastimate-owner',
	install: 'procrastimate-install',
	people: 'procrastimate-people',
	remindersCheckedAt: 'procrastimate-reminders-checked-at',
	/** In `sessionStorage`. */
	unwritten: 'procrastimate-unwritten',
	staleBuildReload: 'procrastimate-stale-build-reload',
	user: 'procrastimate-user',
	theme: 'procrastimate-theme',
	accent: 'procrastimate-accent',
	accentCss: 'procrastimate-accent-css',
	pushRekey: 'procrastimate-push-rekey',
	pushRefusedAt: 'procrastimate-push-refused-at',
	completedRange: 'procrastimate.completedRange',
	showCompleted: 'procrastimate.showCompleted',
	noDateOldestFirst: 'procrastimate.noDateOldestFirst',
	listFilters: 'procrastimate.listFilters',
} as const;

const peopleSchema = z.array(personSchema);

export function saveOwner(id: string) {
	localStorage.setItem(DEVICE_KEYS.owner, id);
}

/**
 * Calls `changed` when another tab makes this browser's database another account's. That tab cleared the rows this
 * one shows, so this tab must not keep reading or uploading as the previous account.
 */
export function onOwnerChange(changed: () => void) {
	window.addEventListener('storage', event => {
		if (event.key === DEVICE_KEYS.owner && event.oldValue !== null && event.newValue !== event.oldValue) changed();
	});
}

/** Push subscriptions and Ramble name the device by it; it is not a secret. */
export function installId(): string {
	const known = localStorage.getItem(DEVICE_KEYS.install);
	if (known) return known;
	const id = crypto.randomUUID();
	localStorage.setItem(DEVICE_KEYS.install, id);
	return id;
}

export function loadPeople(): Person[] {
	try {
		return peopleSchema.parse(JSON.parse(localStorage.getItem(DEVICE_KEYS.people) ?? '[]'));
	} catch {
		return [];
	}
}

export function savePeople(people: readonly Person[]) {
	localStorage.setItem(DEVICE_KEYS.people, JSON.stringify(people));
}

/**
 * Commands whose rows are not in the local database yet. The database writes in the background, so a reload a moment
 * after an edit would lose it; this synchronous copy lets the reloaded page write it first. It lives in
 * `sessionStorage`, one per tab, so two tabs never overwrite or replay each other's copy, and it names the signed-in
 * user, so a tab never writes one account's edits into the database of the next.
 */
export type Unwritten = { owner: string; writes: RowWrite[] };
type Copy = { user: string; commands: Unwritten[] };

export function loadUnwritten(user: string): Unwritten[] {
	try {
		const copy = JSON.parse(sessionStorage.getItem(DEVICE_KEYS.unwritten) ?? 'null') as Copy | null;
		return copy?.user === user ? copy.commands : [];
	} catch {
		return [];
	}
}

/** A copy too large to store is skipped: the edit is still written, it is only not safe from a reload until then. */
export function saveUnwritten(user: string, commands: readonly Unwritten[]) {
	try {
		if (commands.length) sessionStorage.setItem(DEVICE_KEYS.unwritten, JSON.stringify({ user, commands }));
		else sessionStorage.removeItem(DEVICE_KEYS.unwritten);
	} catch {
		sessionStorage.removeItem(DEVICE_KEYS.unwritten);
	}
}

/** A first launch starts from now, so it never announces every reminder that came up before it. */
export function loadRemindersCheckedAt(now: number): number {
	const stored = Number(localStorage.getItem(DEVICE_KEYS.remindersCheckedAt));
	return Number.isFinite(stored) && stored > 0 ? stored : now;
}

export function saveRemindersCheckedAt(at: number) {
	localStorage.setItem(DEVICE_KEYS.remindersCheckedAt, String(at));
}

/**
 * Asks the browser to keep this origin's storage, which holds the local database and its unsent writes. Without it
 * Chromium may evict the database when the disk runs low, and Safari outside a Home Screen app after seven days unvisited.
 */
export async function keepStorage() {
	if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
	await navigator.storage.persist();
}
