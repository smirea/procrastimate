import { formatRecurrence, formatTime, shortDate } from '../../../shared/format';
import type { ActivityAction, ActivityEntry, Person } from '../../../shared/sharing';
import { sameValue } from '../../../shared/sync/diff';
import type { Task } from '../../../shared/sync/protocol';
import { SERVER_ACTOR, type DateKey } from '../../../shared/values';
import type { AccountStore, LogRow } from './store';

/**
 * One task's history, read off the log rather than kept in a table of its own. The log has a row per op, and typing
 * that syncs while it happens is many ops, so the rows are folded into the task's state and each entry names only what really
 * changed: a row that rewrites a value the task already had, such as a second device uploading its snapshot, shows
 * nothing. Consecutive edits by one actor less than `COALESCE_WINDOW` apart are one entry, and a completion or delete
 * undone that quickly by the same actor shows neither.
 */

export const COALESCE_WINDOW = 5 * 60_000;

type Fields = Record<string, unknown>;

/** Bookkeeping fields, the server's stamps, and the ones each action already says. */
const SILENT = new Set([
	'order',
	'createdAt',
	'sourceKey',
	'createdBy',
	'completedBy',
	'completedAt',
	'lastCompletedAt',
	'deleted',
]);

const UNDOES: Partial<Record<ActivityAction, ActivityAction>> = { reopened: 'completed', restored: 'deleted' };

type Draft = {
	at: number;
	actor: string;
	action: ActivityAction;
	/** For an edit, each changed field's value before the run and after it. */
	before: Fields;
	after: Fields;
};

export function unknownPerson(id: string): Person {
	return { id, name: '', kind: 'human', ownerId: null };
}

export function personOf(store: AccountStore, id: string): Person {
	const row = store.people().find(person => person.id === id);
	return row ? { id: row.id, name: row.name, kind: row.kind, ownerId: row.ownerId } : unknownPerson(id);
}

function actionOf(row: Fields, prev: Fields, wasLive: boolean, everLive: boolean): ActivityAction | null {
	if (row.deleted === true) return wasLive ? 'deleted' : null;
	if (!wasLive) return row.deleted === false ? (everLive ? 'restored' : 'created') : null;
	if (typeof row.completedAt === 'number' && prev.completedAt == null) return 'completed';
	if (row.completedAt === null && prev.completedAt != null) return 'reopened';
	if (row.lastCompletedAt !== undefined && !sameValue(row.lastCompletedAt, prev.lastCompletedAt)) return 'completed';
	return 'edited';
}

function changedFields(row: Fields, prev: Fields): string[] {
	return Object.keys(row).filter(name => !SILENT.has(name) && !sameValue(prev[name], row[name]));
}

export function taskActivity(store: AccountStore, taskId: string): ActivityEntry[] {
	const rows = store
		.logAfter(0, Number.MAX_SAFE_INTEGER)
		.filter((row: LogRow) => row.kind === 'task' && row.id === taskId);
	const drafts: Draft[] = [];
	const seen = new Set<string>();
	let data: Fields = {};
	let everLive = false;
	for (const row of rows) {
		if (seen.has(row.opId)) continue;
		seen.add(row.opId);
		const fields = row.fields as Fields;
		const prev = data;
		const wasLive = prev.deleted === false;
		data = { ...prev, ...fields };
		const action = actionOf(fields, prev, wasLive, everLive);
		if (data.deleted === false) everLive = true;
		if (!action || row.actor === SERVER_ACTOR) continue;

		const last = drafts.at(-1);
		const recent = last !== undefined && last.actor === row.actor && row.at - last.at <= COALESCE_WINDOW;
		if (recent && UNDOES[action] === last.action) {
			drafts.pop();
			continue;
		}
		if (action !== 'edited') {
			drafts.push({ at: row.at, actor: row.actor, action, before: {}, after: {} });
			continue;
		}
		const changed = changedFields(fields, prev);
		if (!changed.length) continue;
		const draft: Draft =
			recent && last.action === 'edited'
				? last
				: drafts[drafts.push({ at: row.at, actor: row.actor, action, before: {}, after: {} }) - 1]!;
		draft.at = row.at;
		for (const name of changed) {
			if (!(name in draft.before)) draft.before[name] = prev[name];
			draft.after[name] = data[name];
		}
		for (const name of Object.keys(draft.after)) {
			if (!sameValue(draft.before[name], draft.after[name])) continue;
			delete draft.before[name];
			delete draft.after[name];
		}
		if (!Object.keys(draft.after).length) drafts.splice(drafts.indexOf(draft), 1);
	}

	const people = new Map(store.people().map(row => [row.id, row]));
	const nameOf = (kind: 'project' | 'label' | 'task', id: string) => {
		const entity = store.entity(kind, id);
		const name = entity?.data[kind === 'task' ? 'title' : 'name'];
		return typeof name === 'string' ? name : null;
	};
	return drafts.flatMap(draft => {
		const summary = summarize(draft, nameOf);
		if (!summary) return [];
		const person = people.get(draft.actor);
		return [
			{
				at: draft.at,
				actor: person
					? { id: person.id, name: person.name, kind: person.kind, ownerId: person.ownerId }
					: unknownPerson(draft.actor),
				action: draft.action,
				summary,
			},
		];
	});
}

type NameOf = (kind: 'project' | 'label' | 'task', id: string) => string | null;

const ACTION_SUMMARIES: Record<Exclude<ActivityAction, 'edited'>, string> = {
	created: 'added this task',
	completed: 'completed it',
	reopened: 'reopened it',
	deleted: 'deleted it',
	restored: 'restored it',
};

const quoted = (text: string) => `“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`;

function listOf(names: string[]) {
	return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function summarize(draft: Draft, nameOf: NameOf): string | null {
	if (draft.action !== 'edited') return ACTION_SUMMARIES[draft.action];
	const today = new Date(draft.at).toISOString().slice(0, 10) as DateKey;
	const parts = Object.keys(draft.after).flatMap(name => {
		const part = describeField(name, draft.before[name], draft.after[name], today, draft.after, nameOf);
		return part ? [part] : [];
	});
	return parts.length ? listOf(parts) : null;
}

function describeField(
	name: string,
	before: unknown,
	after: unknown,
	today: DateKey,
	changes: Fields,
	nameOf: NameOf,
): string | null {
	switch (name) {
		case 'title':
			return `renamed it to ${quoted(String(after))}`;
		case 'notes':
			if (!before) return 'added notes';
			return after ? 'edited notes' : 'removed the notes';
		case 'due': {
			const due = after as Task['due'];
			if (!due) return 'removed the due date';
			const when = due.time ? `${shortDate(due.date, today)} at ${formatTime(due.time)}` : shortDate(due.date, today);
			return `${before ? 'changed' : 'set'} due to ${when}`;
		}
		case 'recurrence': {
			const recurrence = after as Task['recurrence'];
			if (!recurrence) return 'stopped repeating it';
			const repeat = formatRecurrence(recurrence, (changes.due as Task['due'] | undefined) ?? null);
			return `set it to repeat ${repeat[0]!.toLowerCase()}${repeat.slice(1)}`;
		}
		case 'priority':
			return `changed priority to P${String(after)}`;
		case 'projectId':
			return after === null ? 'moved it to Inbox' : `moved it to ${nameOf('project', String(after)) ?? 'a project'}`;
		case 'labelIds': {
			const old = new Set((before as string[] | undefined) ?? []);
			const next = new Set((after as string[] | undefined) ?? []);
			const names = (ids: string[]) => ids.map(id => nameOf('label', id) ?? 'a label');
			const added = names([...next].filter(id => !old.has(id)));
			const removed = names([...old].filter(id => !next.has(id)));
			const parts = [
				added.length ? `added ${added.length > 1 ? 'labels' : 'label'} ${listOf(added)}` : '',
				removed.length ? `removed ${removed.length > 1 ? 'labels' : 'label'} ${listOf(removed)}` : '',
			].filter(Boolean);
			return parts.length ? parts.join(' and ') : null;
		}
		case 'parentId': {
			if (after === null) return 'made it a top-level task';
			const parent = nameOf('task', String(after));
			return parent ? `made it a subtask of ${quoted(parent)}` : 'made it a subtask';
		}
		case 'reminders':
			return (after as unknown[]).length ? 'changed the reminders' : 'removed the reminders';
		case 'location': {
			const place = after as Task['location'];
			return place ? `set the place to ${place.name}` : 'removed the place';
		}
		case 'event': {
			// iOS rewrites an event's title and times whenever the calendar moves it; only linking or unlinking is news.
			const event = after as Task['event'];
			if (event && (before as Task['event'])?.id === event.id) return null;
			return event ? `linked it to ${quoted(event.title)}` : 'unlinked the event';
		}
		default:
			return `changed ${name}`;
	}
}
