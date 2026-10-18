import { ORPCError } from '@orpc/server';
import { and, eq, inArray, like, max, sql } from 'drizzle-orm';
import { log, tasks } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import {
	memoSourceKey,
	parseMemoSource,
	type MemoTaskInput,
	type MemoTasks,
	type MemoTasksRequest,
} from '../../shared/memo-tasks';
import { fieldsOf } from '../../shared/snapshot';
import { byCreation } from '../../shared/snapshot';
import type { Task } from '../../shared/model';
import { parseQuickAdd } from '../../shared/quick-add';
import { descendantsOf, detachOrphans } from '../../shared/subtasks';
import { DEFAULT_PRIORITY } from '../../shared/values';
import { wallDate } from '../../shared/zoned-time';
import type { Command } from './commands';
import type { Db } from './db/postgres';
import { entity, storedZone } from './space';
import { applyAs, type Write } from './writes';

/**
 * Notouroboros's routes, for the owner's own space. Writes go through `applyAs` like every other, so they land in
 * the log and reach every device through PowerSync. A memo's tasks are found by their source key's prefix.
 */

const memoPrefix = (memoId: string) => `${memoSourceKey({ memoId, taskKey: '' })}%`;

/** The memo's live tasks, oldest first. The prefix narrows the select; `parseMemoSource` decides. */
async function tasksOfMemo(db: Db, owner: string, memoId: string): Promise<Task[]> {
	const rows = await db
		.select()
		.from(tasks)
		.where(and(eq(tasks.userId, owner), like(tasks.sourceKey, memoPrefix(memoId))));
	return (rows.map(entity) as Task[])
		.filter(task => parseMemoSource(task.sourceKey)?.memoId === memoId)
		.toSorted(byCreation);
}

function memoTasks(list: readonly Task[]): MemoTasks {
	return {
		tasks: list.map(({ id, title, completedAt, due, event, sourceKey }) => ({
			key: parseMemoSource(sourceKey)!.taskKey,
			id,
			title,
			completedAt,
			due,
			event,
		})),
	};
}

export const listMemoTasks = async (db: Db, owner: string, memoId: string) =>
	memoTasks(await tasksOfMemo(db, owner, memoId));

/**
 * Which of `keys` a task of the space has held, deleted tasks' included, so a deleted memo task never comes back. A
 * delete removes the row, so the history is the log's, read through its source key index.
 */
async function loggedSourceKeys(db: Db, owner: string, keys: readonly string[]): Promise<string[]> {
	const key = sql<string>`${log.fields}->>'sourceKey'`;
	const rows = await db
		.selectDistinct({ key })
		.from(log)
		.where(and(eq(log.userId, owner), eq(log.kind, 'task'), sql`${log.fields} ? 'sourceKey'`, inArray(key, keys)));
	return rows.map(row => row.key);
}

/** A memo task's id, the same for every send of the memo, as a version 8 UUID of a SHA-256 of what names it. */
async function memoTaskId(owner: string, memoId: string, taskKey: string): Promise<string> {
	const named = new TextEncoder().encode(JSON.stringify([owner, memoId, taskKey]));
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', named)).slice(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x80;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The spoken phrase read as of the recording, in the account's zone. An event replaces the date and repeat. */
function schedule({ when, event }: MemoTaskInput, recordedAt: number, zone: string): Pick<Task, 'due' | 'recurrence'> {
	if (event || !when) return { due: null, recurrence: null };
	const { due, recurrence } = parseQuickAdd(when, { now: wallDate(recordedAt, zone), spoken: true });
	return { due, recurrence };
}

export async function putMemoTasks(command: Command, request: MemoTasksRequest): Promise<MemoTasks> {
	const { db, owner, actor, client, now } = command;
	const keys = request.tasks.map(input => memoSourceKey({ memoId: request.memoId, taskKey: input.key }));
	const [live, logged] = await Promise.all([
		tasksOfMemo(db, owner, request.memoId),
		keys.length ? loggedSourceKeys(db, owner, keys) : [],
	]);
	const known = new Set([...logged, ...live.map(task => task.sourceKey!)]);
	const fresh = request.tasks.filter((_, index) => {
		if (known.has(keys[index]!)) return false;
		known.add(keys[index]!);
		return true;
	});
	if (!fresh.length) return memoTasks(live);
	const [zone, [newest]] = await Promise.all([
		storedZone(db, owner),
		db
			.select({ createdAt: max(tasks.createdAt) })
			.from(tasks)
			.where(eq(tasks.userId, owner)),
	]);
	// Past the newest task, like `addTask`, so the memo's tasks keep the order they were sent in.
	let createdAt = Math.max(now, (newest?.createdAt ?? -Infinity) + 1);
	const ids = await Promise.all(fresh.map(input => memoTaskId(owner, request.memoId, input.key)));
	const added: Task[] = fresh.map((input, index) => ({
		id: ids[index]!,
		parentId: null,
		order: 0,
		title: input.title,
		notes: input.notes,
		projectId: null,
		sectionId: null,
		labelIds: [],
		...schedule(input, request.recordedAt, zone),
		priority: DEFAULT_PRIORITY,
		reminders: [],
		location: null,
		event: input.event,
		images: [],
		createdAt: createdAt++,
		completedAt: null,
		createdBy: null,
		completedBy: null,
		lastCompletedAt: null,
		sourceKey: memoSourceKey({ memoId: request.memoId, taskKey: input.key }),
	}));
	// Two overlapping sends both find a key fresh, and their puts of the one id converge on one task; the source key
	// names the write in the log, so the log keeps one row too.
	const writes: Write[] = added.map(task => ({
		op: 'put',
		kind: 'task',
		id: task.id,
		values: fieldsOf('task', task),
		opId: task.sourceKey!,
	}));
	const { rejected } = await applyAs(db, { actor, client, now }, owner, { role: 'owner' }, writes);
	if (rejected.length) throw new ORPCError('BAD_REQUEST', { message: rejected[0]!.reason });
	return memoTasks([...live, ...added]);
}

/** The memo's tasks and every subtask under them, found over the space's parent links alone. */
export async function deleteMemoTasks(command: Command, memoId: string): Promise<void> {
	const { db, owner, actor, client, now } = command;
	const links = await db
		.select({
			id: tasks.id,
			parentId: tasks.parentId,
			order: tasks.order,
			createdAt: tasks.createdAt,
			sourceKey: tasks.sourceKey,
		})
		.from(tasks)
		.where(eq(tasks.userId, owner));
	const tree = detachOrphans(links);
	const gone = new Set<string>();
	for (const task of tree) {
		if (parseMemoSource(task.sourceKey)?.memoId !== memoId) continue;
		gone.add(task.id);
		for (const subtask of descendantsOf(tree, task.id)) gone.add(subtask.id);
	}
	const writes: Write[] = [...gone].map(id => ({ op: 'delete', kind: 'task', id, opId: newId() }));
	if (!writes.length) return;
	const { rejected } = await applyAs(db, { actor, client, now }, owner, { role: 'owner' }, writes);
	if (rejected.length) throw new ORPCError('BAD_REQUEST', { message: rejected[0]!.reason });
}
