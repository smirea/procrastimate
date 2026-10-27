import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { comments, labels, log, projects, sections, tasks } from '../../shared/db/schema';
import { formatRecurrence, formatTime, shortDate } from '../../shared/format';
import type { Task } from '../../shared/model';
import { sameValue } from '../../shared/rows';
import type { ActivityAction, ActivityEntry } from '../../shared/sharing';
import { SERVER_ACTOR, type DateKey } from '../../shared/values';
import type { Db } from './db/sqlite';
import { chunks } from './db/chunks';
import { peopleById, unknownPerson } from './people';
import { seenBy, type Sight } from './space';

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

/** The task's rows and the first row of each of its comments still there: a deleted comment is no longer quoted. */
async function rowsOn(db: Db, owner: string, taskId: string): Promise<LogRow[]> {
	const [rows, live] = await Promise.all([
		db
			.select()
			.from(log)
			.where(
				and(
					eq(log.userId, owner),
					or(
						and(eq(log.kind, 'task'), eq(log.id, taskId)),
						and(eq(log.kind, 'comment'), eq(log.op, 'put'), sql`${log.fields} ->> '$.taskId' = ${taskId}`),
					),
				),
			)
			.orderBy(asc(log.seq)),
		db
			.select({ id: comments.id })
			.from(comments)
			.where(and(eq(comments.userId, owner), eq(comments.taskId, taskId))),
	]);
	const kept = new Set(live.map(comment => comment.id));
	return rows.filter(row => row.kind !== 'comment' || kept.has(row.id));
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

const NAMED = {
	task: { table: tasks, name: tasks.title },
	project: { table: projects, name: projects.name },
	section: { table: sections, name: sections.name },
	label: { table: labels, name: labels.name },
};

type Named = keyof typeof NAMED;

/** The tasks, projects, sections, and labels the summaries name, read by id once the drafts say which. */
async function namesFor(db: Db, owner: string, sight: Sight, drafts: readonly Draft[]): Promise<NameOf> {
	const wanted: Record<Named, Set<string>> = {
		task: new Set(),
		project: new Set(),
		section: new Set(),
		label: new Set(),
	};
	for (const { action, before, after } of drafts) {
		if (action !== 'edited') continue;
		if (typeof after.projectId === 'string') wanted.project.add(after.projectId);
		if (typeof after.sectionId === 'string') wanted.section.add(after.sectionId);
		if (typeof after.parentId === 'string') wanted.task.add(after.parentId);
		for (const id of [before.labelIds, after.labelIds].flat()) if (typeof id === 'string') wanted.label.add(id);
	}
	const kinds = Object.keys(NAMED) as Named[];
	const found = await Promise.all(
		kinds.map(kind => {
			const { table, name } = NAMED[kind];
			const ids = [...wanted[kind]];
			return chunks(ids).flatMap(part =>
				db
					.select({ id: table.id, name })
					.from(table)
					.where(and(eq(table.userId, owner), inArray(table.id, part), seenBy(db, sight, owner, table.id, kind)))
					.all(),
			);
		}),
	);
	const byKind = new Map(kinds.map((kind, index) => [kind, new Map(found[index]!.map(row => [row.id, row.name]))]));
	return (kind, id) => byKind.get(kind)!.get(id) ?? null;
}

/** The task's entries, naming only the projects, sections, labels, and parents `sight` sees. */
export async function taskActivity(db: Db, owner: string, sight: Sight, taskId: string): Promise<ActivityEntry[]> {
	const drafts = foldActivity(await rowsOn(db, owner, taskId));
	const [people, nameOf] = await Promise.all([
		peopleById(
			db,
			drafts.map(draft => draft.actor),
		),
		namesFor(db, owner, sight, drafts),
	]);
	return drafts.flatMap(draft => {
		const summary = summarize(draft, nameOf);
		if (!summary) return [];
		const actor = people.get(draft.actor) ?? unknownPerson(draft.actor);
		return [{ at: draft.at, actor, action: draft.action, summary }];
	});
}

type NameOf = (kind: Named, id: string) => string | null;

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

/** Names the labels the reader sees and counts the rest: `added labels home and another label`. */
function labelChange(verb: string, ids: string[], nameOf: NameOf): string {
	if (!ids.length) return '';
	const names = ids.flatMap(id => nameOf('label', id) ?? []);
	const unnamed = ids.length - names.length;
	if (!names.length) return unnamed === 1 ? `${verb} a label` : `${verb} ${unnamed} labels`;
	if (unnamed) names.push(unnamed === 1 ? 'another label' : `${unnamed} other labels`);
	return `${verb} ${ids.length > 1 ? 'labels' : 'label'} ${listOf(names)}`;
}

function summarize(draft: Draft, nameOf: NameOf): string | null {
	if (draft.action === 'commented') return `commented ${quoted(String(draft.after.body))}`;
	if (draft.action !== 'edited') return ACTION_SUMMARIES[draft.action];
	const today = new Date(draft.at).toISOString().slice(0, 10) as DateKey;
	const parts = Object.keys(draft.after).flatMap(name => {
		const part = describeField(name, draft.before[name], draft.after[name], today, draft.state, draft.after, nameOf);
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
	changed: Fields,
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
			return after === null
				? 'moved it to Inbox'
				: `moved it to ${nameOf('project', String(after)) ?? 'another project'}`;
		case 'sectionId':
			if (after !== null) {
				const section = nameOf('section', String(after));
				return section ? `put it in section ${section}` : 'put it in a section';
			}
			// Moving a task to another project leaves its section, which the move already says.
			return 'projectId' in changed ? null : 'took it out of its section';
		case 'labelIds': {
			const old = new Set((before as string[] | undefined) ?? []);
			const next = new Set((after as string[] | undefined) ?? []);
			const parts = [
				labelChange(
					'added',
					[...next].filter(id => !old.has(id)),
					nameOf,
				),
				labelChange(
					'removed',
					[...old].filter(id => !next.has(id)),
					nameOf,
				),
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
