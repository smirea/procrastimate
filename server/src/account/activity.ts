import type { ActivityAction, ActivityEntry, Person } from '../../../shared/sharing';
import { SERVER_ACTOR } from '../../../shared/values';
import type { AccountStore, LogRow } from './store';

/**
 * One task's history, read off the log rather than kept in a table of its own. Each row is classified by the fields
 * that won: a task that appears with its title was created, or restored when it had been deleted before; a tombstone
 * is a delete; a completion sets `completedAt` or moves `lastCompletedAt` (a recurring roll); a reopen clears
 * `completedAt`; anything else is an edit naming its fields. The server's own repairs never show.
 */

const STAMPS = new Set(['createdBy', 'completedBy']);

function classify(fields: Record<string, unknown>, deletedBefore: boolean): ActivityAction | null {
	if (fields.deleted === true) return 'deleted';
	if (fields.deleted === false && fields.title !== undefined) return deletedBefore ? 'restored' : 'created';
	if (typeof fields.completedAt === 'number' || fields.lastCompletedAt !== undefined) return 'completed';
	if (fields.completedAt === null) return 'reopened';
	const names = Object.keys(fields).filter(name => !STAMPS.has(name));
	return names.length ? 'edited' : null;
}

export function unknownPerson(id: string): Person {
	return { id, name: '', kind: 'human', ownerId: null };
}

export function personOf(store: AccountStore, id: string): Person {
	const row = store.people().find(person => person.id === id);
	return row ? { id: row.id, name: row.name, kind: row.kind, ownerId: row.ownerId } : unknownPerson(id);
}

export function taskActivity(store: AccountStore, taskId: string): ActivityEntry[] {
	const people = new Map(store.people().map(row => [row.id, row]));
	const rows = store
		.logAfter(0, Number.MAX_SAFE_INTEGER)
		.filter((row: LogRow) => row.kind === 'task' && row.id === taskId && row.actor !== SERVER_ACTOR);
	const entries: ActivityEntry[] = [];
	let deleted = false;
	for (const row of rows) {
		const fields = row.fields as Record<string, unknown>;
		const action = classify(fields, deleted);
		if (action === 'deleted') deleted = true;
		if (action === 'created' || action === 'restored') deleted = false;
		if (!action) continue;
		const person = people.get(row.actor);
		entries.push({
			at: row.at,
			actor: person
				? { id: person.id, name: person.name, kind: person.kind, ownerId: person.ownerId }
				: unknownPerson(row.actor),
			action,
			fields: action === 'edited' ? Object.keys(fields).filter(name => !STAMPS.has(name)) : [],
		});
	}
	return entries;
}
