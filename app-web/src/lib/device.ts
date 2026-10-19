import { z } from 'zod';
import type { RowWrite } from 'shared/rows.ts';
import { personSchema, type Person } from 'shared/sharing.ts';

/** The account this browser's database was last opened for, so other tabs reload when it changes. */
const OWNER_KEY = 'procrastimate-owner';
const INSTALL_KEY = 'procrastimate-install';
const DATABASE_KEY = 'procrastimate-database';
const PEOPLE_KEY = 'procrastimate-people';
const REMINDERS_KEY = 'procrastimate-reminders-checked-at';
const UNWRITTEN_KEY = 'procrastimate-unwritten';
const LEGACY_DOCUMENT_KEY = 'procrastimate';
/** The view choices and the cached account, also device-local, read by their own modules. */
export const DEVICE_KEYS = {
	user: 'procrastimate-user',
	theme: 'procrastimate-theme',
	accent: 'procrastimate-accent',
	pushRekey: 'procrastimate-push-rekey',
	completedRange: 'procrastimate.completedRange',
	showCompleted: 'procrastimate.showCompleted',
	noDateOldestFirst: 'procrastimate.noDateOldestFirst',
} as const;

const peopleSchema = z.array(personSchema);

export function forgetLegacyDocument() {
	localStorage.removeItem(LEGACY_DOCUMENT_KEY);
}

export function saveOwner(id: string) {
	localStorage.setItem(OWNER_KEY, id);
}

/**
 * Calls `changed` when another tab makes this browser's database another account's. That tab cleared the rows this
 * one shows, so this tab must not keep reading or uploading as the previous account.
 */
export function onOwnerChange(changed: () => void) {
	window.addEventListener('storage', event => {
		if (event.key === OWNER_KEY && event.oldValue !== null && event.newValue !== event.oldValue) changed();
	});
}

/** Push subscriptions and Ramble name the device by it; it is not a secret. */
export function installId(): string {
	const known = localStorage.getItem(INSTALL_KEY);
	if (known) return known;
	const id = crypto.randomUUID();
	localStorage.setItem(INSTALL_KEY, id);
	return id;
}

/**
 * Names this local database, so an upload's op ids (`<database>:<queue id>`) never repeat: PowerSync's queue ids
 * restart when the database is cleared, so a cleared database gets a new name.
 */
export function databaseId(): string {
	const known = localStorage.getItem(DATABASE_KEY);
	if (known) return known;
	const id = crypto.randomUUID();
	localStorage.setItem(DATABASE_KEY, id);
	return id;
}

export function forgetDatabaseId() {
	localStorage.removeItem(DATABASE_KEY);
}

export function loadPeople(): Person[] {
	try {
		return peopleSchema.parse(JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? '[]'));
	} catch {
		return [];
	}
}

export function savePeople(people: readonly Person[]) {
	localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
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
		const copy = JSON.parse(sessionStorage.getItem(UNWRITTEN_KEY) ?? 'null') as Copy | null;
		return copy?.user === user ? copy.commands : [];
	} catch {
		return [];
	}
}

/** A copy too large to store is skipped: the edit is still written, it is only not safe from a reload until then. */
export function saveUnwritten(user: string, commands: readonly Unwritten[]) {
	try {
		if (commands.length) sessionStorage.setItem(UNWRITTEN_KEY, JSON.stringify({ user, commands }));
		else sessionStorage.removeItem(UNWRITTEN_KEY);
	} catch {
		sessionStorage.removeItem(UNWRITTEN_KEY);
	}
}

/** A first launch starts from now, so it never announces every reminder that came up before it. */
export function loadRemindersCheckedAt(now: number): number {
	const stored = Number(localStorage.getItem(REMINDERS_KEY));
	return Number.isFinite(stored) && stored > 0 ? stored : now;
}

export function saveRemindersCheckedAt(at: number) {
	localStorage.setItem(REMINDERS_KEY, String(at));
}

/**
 * Asks the browser to keep this origin's storage, which holds the local database and its unsent writes. Without it
 * Chromium may evict the database when the disk runs low, and Safari outside a Home Screen app after seven days unvisited.
 */
export async function keepStorage() {
	if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
	await navigator.storage.persist();
}
