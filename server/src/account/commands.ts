import { ORPCError } from '@orpc/server';
import type { AgentNewTask, SpaceView } from '../../../shared/sharing';
import { newId } from '../../../shared/id';
import { parseQuickAdd } from '../../../shared/quick-add';
import { admit, type Grant } from '../../../shared/scope';
import {
	addTask,
	completeTask,
	deleteTask,
	reopenTask,
	updateTask,
	type Creation,
	type StoreData,
	type TaskPatch,
} from '../../../shared/store';
import { diff, stamp } from '../../../shared/sync/diff';
import { serverSnapshot } from '../../../shared/sync/merge';
import type { Snapshot, Task } from '../../../shared/sync/protocol';
import { isTimeZone, wallDate, zonedDateKey } from '../../../shared/zoned-time';
import type { Access } from '../auth';
import type { AccountStore } from './store';
import { guestView, loadState, push } from './sync';

/**
 * The agent command API: the store's rules run on the server over the space's snapshot, diffed, stamped, and pushed
 * through the same merge and the same admission a guest's synced ops meet. `memo-tasks.ts` is the same shape for
 * NoteTorus.
 */

type Space = { store: AccountStore; now: number; actor: string; access: Access };

const grantsOf = (access: Access): readonly Grant[] | null => (access.role === 'owner' ? null : access.shares);

/** What the actor sees of the space. Owners see everything and may edit it all. */
export function viewOf(snapshot: Snapshot, access: Access): SpaceView {
	const grants = grantsOf(access);
	if (!grants) return { tasks: snapshot.tasks, projects: snapshot.projects, labels: snapshot.labels, readOnly: [] };
	const { filtered, readOnly } = guestView(snapshot, grants);
	return { tasks: filtered.tasks, projects: filtered.projects, labels: filtered.labels, readOnly };
}

export const view = ({ store, access }: Space): SpaceView => viewOf(serverSnapshot(loadState(store)), access);

const zoneOf = (snapshot: Snapshot) =>
	snapshot.settings.timeZone && isTimeZone(snapshot.settings.timeZone) ? snapshot.settings.timeZone : 'UTC';

function run(space: Space, command: (data: StoreData, visible: SpaceView, zone: string) => StoreData): Snapshot {
	const { store, now, actor, access } = space;
	return store.transaction(() => {
		const before = loadState(store);
		const snapshot = serverSnapshot(before);
		const visible = viewOf(snapshot, access);
		const { tasks, projects, labels } = snapshot;
		const next = command({ tasks, projects, labels }, visible, zoneOf(snapshot));
		const patches = diff(snapshot, { ...snapshot, ...next });
		const { ops } = stamp(patches, before.clock, now);
		const grants = grantsOf(access);
		if (grants && admit(snapshot, grants, ops).refused.length) {
			throw new ORPCError('FORBIDDEN', { message: 'Not editable in this share' });
		}
		return serverSnapshot(push(store, before, ops, now, actor).state);
	});
}

function visibleTask(visible: SpaceView, id: string): Task {
	const task = visible.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return task;
}

function taskAfter(snapshot: Snapshot, id: string): Task {
	const task = snapshot.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return task;
}

/** `text` is read like the app's quick add, against the space's projects and labels; explicit fields win over it. */
export function createTask(space: Space, input: AgentNewTask): Task {
	const id = newId();
	const snapshot = run(space, (data, visible, zone) => {
		const parsed = input.text
			? parseQuickAdd(input.text, {
					now: wallDate(space.now, zone),
					projects: visible.projects,
					labels: visible.labels,
				})
			: null;
		const title = (input.title ?? parsed?.title ?? '').trim();
		if (!title) throw new ORPCError('BAD_REQUEST', { message: 'A task needs a title' });
		if (input.parentId) visibleTask(visible, input.parentId);
		const creation: Creation = { id, now: space.now };
		const added = addTask(
			data,
			{
				title,
				projectId: input.projectId ?? parsed?.projectId ?? null,
				labelIds: input.labelIds ?? parsed?.labelIds ?? [],
				due: parsed?.due ?? null,
				recurrence: parsed?.recurrence ?? null,
				priority: input.priority ?? parsed?.priority ?? null,
				reminders: parsed?.reminders ?? [],
			},
			input.parentId ?? null,
			creation,
		);
		return input.notes ? updateTask(added.data, id, { notes: input.notes }) : added.data;
	});
	return taskAfter(snapshot, id);
}

export function editTask(space: Space, id: string, patch: TaskPatch): Task {
	const snapshot = run(space, (data, visible) => {
		visibleTask(visible, id);
		return updateTask(data, id, patch);
	});
	return taskAfter(snapshot, id);
}

export function finishTask(space: Space, id: string): Task {
	const snapshot = run(space, (data, visible, zone) => {
		visibleTask(visible, id);
		return completeTask(data, id, zonedDateKey(space.now, zone), space.now)?.data ?? data;
	});
	return taskAfter(snapshot, id);
}

export function reopen(space: Space, id: string): Task {
	const snapshot = run(space, (data, visible) => {
		visibleTask(visible, id);
		return reopenTask(data, id);
	});
	return taskAfter(snapshot, id);
}

export function removeTask(space: Space, id: string): void {
	run(space, (data, visible) => {
		visibleTask(visible, id);
		return deleteTask(data, id).data;
	});
}
