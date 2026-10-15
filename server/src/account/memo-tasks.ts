import { newId } from '../../../shared/id';
import {
	memoSourceKey,
	parseMemoSource,
	type MemoTaskInput,
	type MemoTasks,
	type MemoTasksRequest,
} from '../../../shared/memo-tasks';
import { parseQuickAdd } from '../../../shared/quick-add';
import { descendantsOf } from '../../../shared/subtasks';
import { diff, stamp } from '../../../shared/sync/diff';
import { serverSnapshot, type ServerState } from '../../../shared/sync/merge';
import type { Snapshot, Task } from '../../../shared/sync/protocol';
import { DEFAULT_PRIORITY } from '../../../shared/values';
import { wallDate } from '../../../shared/zoned-time';
import type { AccountStore } from './store';
import { loadState, push } from './sync';

/**
 * Notouroboros's routes. Writes are server ops through the same merge as `POST /api/sync`, so they land in the
 * log, get the fixups, and nudge every device.
 */

function memoTasks(snapshot: Snapshot, memoId: string): MemoTasks {
	const tasks = snapshot.tasks.flatMap(({ id, title, completedAt, due, event, sourceKey }) => {
		const source = parseMemoSource(sourceKey);
		return source?.memoId === memoId ? [{ key: source.taskKey, id, title, completedAt, due, event }] : [];
	});
	return { tasks };
}

export const listMemoTasks = (store: AccountStore, memoId: string) =>
	memoTasks(serverSnapshot(loadState(store)), memoId);

/** Every task source key the account holds, deleted tasks' included, so a deleted memo task never comes back. */
function knownSourceKeys(state: ServerState): Set<string> {
	const keys = new Set<string>();
	for (const { kind, data } of state.entities.values()) {
		if (kind === 'task' && typeof data.sourceKey === 'string') keys.add(data.sourceKey);
	}
	return keys;
}

/** The spoken phrase read as of the recording, in the account's zone. An event replaces the date and repeat. */
function schedule({ when, event }: MemoTaskInput, recordedAt: number, zone: string): Pick<Task, 'due' | 'recurrence'> {
	if (event || !when) return { due: null, recurrence: null };
	const { due, recurrence } = parseQuickAdd(when, { now: wallDate(recordedAt, zone), spoken: true });
	return { due, recurrence };
}

export function putMemoTasks(store: AccountStore, request: MemoTasksRequest, now: number): MemoTasks {
	return store.transaction(() => {
		const before = loadState(store);
		const snapshot = serverSnapshot(before);
		const known = knownSourceKeys(before);
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
				labelIds: [],
				...schedule(input, request.recordedAt, zone),
				priority: DEFAULT_PRIORITY,
				reminders: [],
				location: null,
				event: input.event,
				createdAt: createdAt++,
				completedAt: null,
				sourceKey,
			});
		}
		if (!added.length) return memoTasks(snapshot, request.memoId);
		const opIds = added.map(task => task.sourceKey!).values();
		const patches = diff(snapshot, { ...snapshot, tasks: [...snapshot.tasks, ...added] });
		const { ops } = stamp(patches, before.clock, now, () => opIds.next().value!);
		return memoTasks(serverSnapshot(push(store, before, ops, now).state), request.memoId);
	});
}

export function deleteMemoTasks(store: AccountStore, memoId: string, now: number): void {
	store.transaction(() => {
		const before = loadState(store);
		const snapshot = serverSnapshot(before);
		const gone = new Set<string>();
		for (const task of snapshot.tasks) {
			if (parseMemoSource(task.sourceKey)?.memoId !== memoId) continue;
			gone.add(task.id);
			for (const subtask of descendantsOf(snapshot.tasks, task.id)) gone.add(subtask.id);
		}
		if (!gone.size) return;
		const patches = diff(snapshot, { ...snapshot, tasks: snapshot.tasks.filter(task => !gone.has(task.id)) });
		push(store, before, stamp(patches, before.clock, now).ops, now);
	});
}
