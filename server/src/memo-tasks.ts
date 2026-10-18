import { and, eq, sql } from 'drizzle-orm';
import { log } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import {
	memoSourceKey,
	parseMemoSource,
	type MemoTaskInput,
	type MemoTasks,
	type MemoTasksRequest,
} from '../../shared/memo-tasks';
import type { Snapshot, Task } from '../../shared/model';
import { parseQuickAdd } from '../../shared/quick-add';
import { rowWrites } from '../../shared/rows';
import { descendantsOf } from '../../shared/subtasks';
import { DEFAULT_PRIORITY } from '../../shared/values';
import { wallDate } from '../../shared/zoned-time';
import type { Command } from './commands';
import type { Db } from './db/postgres';
import { loadSpace } from './space';
import { transact, type Write } from './writes';

/**
 * Notouroboros's routes. Writes go through `transact` like every other, so they land in the log, get the repairs,
 * and reach every device through PowerSync.
 */

function memoTasks(snapshot: Snapshot, memoId: string): MemoTasks {
	const tasks = snapshot.tasks.flatMap(({ id, title, completedAt, due, event, sourceKey }) => {
		const source = parseMemoSource(sourceKey);
		return source?.memoId === memoId ? [{ key: source.taskKey, id, title, completedAt, due, event }] : [];
	});
	return { tasks };
}

export const listMemoTasks = async (db: Db, owner: string, memoId: string) =>
	memoTasks((await loadSpace(db, owner)).snapshot, memoId);

/**
 * Every task source key the space has held, deleted tasks' included, so a deleted memo task never comes back. A
 * delete removes the row, so the history is the log's.
 */
async function knownSourceKeys(db: Db, owner: string, snapshot: Snapshot): Promise<Set<string>> {
	const rows = await db
		.selectDistinct({ key: sql<string>`${log.fields}->>'sourceKey'` })
		.from(log)
		.where(and(eq(log.userId, owner), eq(log.kind, 'task'), sql`${log.fields} ? 'sourceKey'`));
	const keys = new Set(rows.map(row => row.key).filter((key): key is string => typeof key === 'string'));
	for (const task of snapshot.tasks) if (task.sourceKey) keys.add(task.sourceKey);
	return keys;
}

/** The spoken phrase read as of the recording, in the account's zone. An event replaces the date and repeat. */
function schedule({ when, event }: MemoTaskInput, recordedAt: number, zone: string): Pick<Task, 'due' | 'recurrence'> {
	if (event || !when) return { due: null, recurrence: null };
	const { due, recurrence } = parseQuickAdd(when, { now: wallDate(recordedAt, zone), spoken: true });
	return { due, recurrence };
}

export async function putMemoTasks(command: Command, request: MemoTasksRequest): Promise<MemoTasks> {
	const { db, owner, actor, client, now } = command;
	const { fixed } = await transact(db, owner, { actor, client, now }, async ({ snapshot }, tx) => {
		const known = await knownSourceKeys(tx, owner, snapshot);
		const zone = snapshot.settings.timeZone ?? 'UTC';
		// Past the newest task, like `addTask`, so the memo's tasks keep the order they were sent in.
		let createdAt = Math.max(now, (snapshot.tasks.at(-1)?.createdAt ?? -Infinity) + 1);
		const added: Task[] = [];
		for (const input of request.tasks) {
			const sourceKey = memoSourceKey({ memoId: request.memoId, taskKey: input.key });
			if (known.has(sourceKey)) continue;
			known.add(sourceKey);
			added.push({
				id: newId(),
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
				sourceKey,
			});
		}
		const writes: Write[] = rowWrites(snapshot, { ...snapshot, tasks: [...snapshot.tasks, ...added] });
		// The source key names the write in the log, so a memo re-sent after a crash dedupes there too.
		return writes.map(write => ({ ...write, opId: write.values?.sourceKey as string | undefined }));
	});
	return memoTasks(fixed, request.memoId);
}

export async function deleteMemoTasks(command: Command, memoId: string): Promise<void> {
	const { db, owner, actor, client, now } = command;
	await transact(db, owner, { actor, client, now }, ({ snapshot }) => {
		const gone = new Set<string>();
		for (const task of snapshot.tasks) {
			if (parseMemoSource(task.sourceKey)?.memoId !== memoId) continue;
			gone.add(task.id);
			for (const subtask of descendantsOf(snapshot.tasks, task.id)) gone.add(subtask.id);
		}
		if (!gone.size) return [];
		return rowWrites(snapshot, { ...snapshot, tasks: snapshot.tasks.filter(task => !gone.has(task.id)) });
	});
}
