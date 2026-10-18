import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { labels, log, projects, tasks } from '../../shared/db/schema';
import { formatRecurrence, formatTime, shortDate } from '../../shared/format';
import type { Task } from '../../shared/model';
import { sameValue } from '../../shared/rows';
import type { ActivityAction, ActivityEntry } from '../../shared/sharing';
import { SERVER_ACTOR, type DateKey } from '../../shared/values';
import type { Db } from './db/postgres';
import { peopleById, unknownPerson } from './people';

/**
 * One task's history, read off the log rather than kept in a table of its own. The log has a row per applied write,
 * and typing that syncs while it happens is many writes, so the rows are folded into the task's state and each entry
 * names only what really changed: a row that rewrites a value the task already had, such as a device re-uploading a
 * row, shows nothing. Consecutive edits by one actor less than `COALESCE_WINDOW` apart are one entry, and a
 * completion or delete undone that quickly by the same actor shows neither. A comment's first appearance on the task
 * is one `commented` entry quoting it.
 */

export const COALESCE_WINDOW = 5 * 60_000;

type Fields = Record<string, unknown>;
type LogRow = typeof log.$inferSelect;

/** Bookkeeping fields, the server's stamps, and the ones each action already says. */
const SILENT = new Set([
	'order',
	'createdAt',
	'sourceKey',
	'createdBy',
	'completedBy',
	'completedAt',
	'lastCompletedAt',
]);

const UNDOES: Partial<Record<ActivityAction, ActivityAction>> = { reopened: 'completed', restored: 'deleted' };

type Draft = {
	at: number;
	actor: string;
	action: ActivityAction;
	before: Fields;
	after: Fields;
	/** The whole task after the run, for fields a summary reads but the run left alone. */
	state: Fields;
};

function actionOf(
	row: LogRow,
	fields: Fields,
	prev: Fields,
	wasLive: boolean,
	everLive: boolean,
): ActivityAction | null {
	if (row.op === 'delete') return wasLive ? 'deleted' : null;
	if (!wasLive) return row.op === 'put' ? (everLive ? 'restored' : 'created') : null;
	if (typeof fields.completedAt === 'number' && prev.completedAt == null) return 'completed';
	if (fields.completedAt === null && prev.completedAt != null) return 'reopened';
	if (fields.lastCompletedAt !== undefined && !sameValue(fields.lastCompletedAt, prev.lastCompletedAt)) {
		// Undoing a recurring roll restores the previous `lastCompletedAt`, which reads as reopening it.
		const rolled =
			typeof fields.lastCompletedAt === 'number' && fields.lastCompletedAt > Number(prev.lastCompletedAt ?? -1);
		return rolled ? 'completed' : 'reopened';
	}
	return 'edited';
}

function changedFields(row: Fields, prev: Fields): string[] {
	return Object.keys(row).filter(name => !SILENT.has(name) && !sameValue(prev[name], row[name]));
}

async function rowsOn(db: Db, owner: string, taskId: string): Promise<LogRow[]> {
	return db
		.select()
		.from(log)
		.where(
			and(
				eq(log.userId, owner),
				or(
					and(eq(log.kind, 'task'), eq(log.id, taskId)),
					and(eq(log.kind, 'comment'), eq(log.op, 'put'), sql`${log.fields}->>'taskId' = ${taskId}`),
				),
			),
		)
		.orderBy(asc(log.seq));
}

export function foldActivity(rows: readonly LogRow[]): Draft[] {
	const drafts: Draft[] = [];
	const commented = new Set<string>();
	let data: Fields = {};
	let live = false;
	let everLive = false;
	for (const row of rows) {
		const fields = row.fields;
		if (row.kind === 'comment') {
			// Undoing a comment's delete makes it appear again, which is not a new comment.
			if (commented.has(row.id) || row.actor === SERVER_ACTOR) continue;
			commented.add(row.id);
			drafts.push({
				at: row.at,
				actor: row.actor,
				action: 'commented',
				before: {},
				after: { body: fields.body },
				state: data,
			});
			continue;
		}
		const prev = data;
		const wasLive = live;
		const everBefore = everLive;
		if (row.op === 'delete') live = false;
		else {
			data = row.op === 'put' ? { ...fields } : { ...prev, ...fields };
			live = true;
			everLive = true;
		}
		const action = actionOf(row, fields, prev, wasLive, everBefore);
		if (!action || row.actor === SERVER_ACTOR) continue;

		const last = drafts.at(-1);
		const recent = last !== undefined && last.actor === row.actor && row.at - last.at <= COALESCE_WINDOW;
		if (recent && UNDOES[action] === last.action) {
			drafts.pop();
			continue;
		}
		if (action !== 'edited') {
			drafts.push({ at: row.at, actor: row.actor, action, before: {}, after: {}, state: data });
			continue;
		}
		const changed = changedFields(fields, prev);
		if (!changed.length) continue;
		const draft: Draft =
			recent && last.action === 'edited'
				? last
				: drafts[drafts.push({ at: row.at, actor: row.actor, action, before: {}, after: {}, state: data }) - 1]!;
		draft.at = row.at;
		draft.state = data;
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
	return drafts;
}

/** The tasks, projects, and labels the summaries name, read by id once the drafts say which. */
async function namesFor(db: Db, owner: string, drafts: readonly Draft[]): Promise<NameOf> {
	const wanted = { task: new Set<string>(), project: new Set<string>(), label: new Set<string>() };
	for (const { action, before, after } of drafts) {
		if (action !== 'edited') continue;
		if (typeof after.projectId === 'string') wanted.project.add(after.projectId);
		if (typeof after.parentId === 'string') wanted.task.add(after.parentId);
		for (const id of [before.labelIds, after.labelIds].flat()) if (typeof id === 'string') wanted.label.add(id);
	}
	const own = <T extends { userId: PgColumn; id: PgColumn }>(table: T, ids: Set<string>) =>
		and(eq(table.userId, owner), inArray(table.id, [...ids]));
	const [taskNames, projectNames, labelNames] = await Promise.all([
		wanted.task.size ? db.select({ id: tasks.id, name: tasks.title }).from(tasks).where(own(tasks, wanted.task)) : [],
		wanted.project.size
			? db.select({ id: projects.id, name: projects.name }).from(projects).where(own(projects, wanted.project))
			: [],
		wanted.label.size
			? db.select({ id: labels.id, name: labels.name }).from(labels).where(own(labels, wanted.label))
			: [],
	]);
	const byKind = {
		task: new Map(taskNames.map(row => [row.id, row.name])),
		project: new Map(projectNames.map(row => [row.id, row.name])),
		label: new Map(labelNames.map(row => [row.id, row.name])),
	};
	return (kind, id) => byKind[kind].get(id) ?? null;
}

export async function taskActivity(db: Db, owner: string, taskId: string): Promise<ActivityEntry[]> {
	const drafts = foldActivity(await rowsOn(db, owner, taskId));
	const [people, nameOf] = await Promise.all([
		peopleById(
			db,
			drafts.map(draft => draft.actor),
		),
		namesFor(db, owner, drafts),
	]);
	return drafts.flatMap(draft => {
		const summary = summarize(draft, nameOf);
		if (!summary) return [];
		const actor = people.get(draft.actor) ?? unknownPerson(draft.actor);
		return [{ at: draft.at, actor, action: draft.action, summary }];
	});
}

type NameOf = (kind: 'project' | 'label' | 'task', id: string) => string | null;

const ACTION_SUMMARIES: Record<Exclude<ActivityAction, 'edited' | 'commented'>, string> = {
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
	if (draft.action === 'commented') return `commented ${quoted(String(draft.after.body))}`;
	if (draft.action !== 'edited') return ACTION_SUMMARIES[draft.action];
	const today = new Date(draft.at).toISOString().slice(0, 10) as DateKey;
	const parts = Object.keys(draft.after).flatMap(name => {
		const part = describeField(name, draft.before[name], draft.after[name], today, draft.state, nameOf);
		return part ? [part] : [];
	});
	return parts.length ? listOf(parts) : null;
}

function describeField(
	name: string,
	before: unknown,
	after: unknown,
	today: DateKey,
	task: Fields,
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
			const repeat = formatRecurrence(recurrence, (task.due as Task['due'] | undefined) ?? null);
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
