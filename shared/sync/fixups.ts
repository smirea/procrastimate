import { detachOrphans } from '../subtasks.ts';
import type { Task } from '../task.ts';
import type { Snapshot } from './protocol.ts';
import { byCreation } from './snapshot.ts';

/**
 * Repairs that concurrent edits can call for, run by the server after every push. Each one is what the
 * local commands already guarantee, so the result is a state a single device could have produced:
 *
 * - Projects with the same `sourceKey` or name (ignoring case) merge into the oldest, moving their tasks.
 * - Labels with the same name (ignoring case) merge into the oldest, and tasks take the survivor's id.
 * - Tasks with the same `sourceKey` merge into the oldest, and the dropped copies' subtasks move under it.
 * - Tasks drop labels that no longer exist, and tasks in a deleted project move to Inbox.
 * - A subtask whose parent is gone, or whose parents loop, becomes top level.
 * - A subtask takes its root task's project.
 * - An open task reopens every completed task above it.
 */
export function fixups(snapshot: Snapshot): Snapshot {
	const bySource = mergeDuplicates(snapshot.projects, p => p.sourceKey);
	const byName = mergeDuplicates(bySource.kept, p => p.name.toLowerCase());
	const projectOf = (id: string) =>
		byName.survivorOf.get(bySource.survivorOf.get(id) ?? id) ?? bySource.survivorOf.get(id) ?? id;
	const projects = new Set(byName.kept.map(p => p.id));

	const labelMerge = mergeDuplicates(snapshot.labels, l => l.name.toLowerCase());
	const labels = new Set(labelMerge.kept.map(l => l.id));

	const taskMerge = mergeDuplicates(snapshot.tasks, t => t.sourceKey);

	let tasks = taskMerge.kept.map(task => {
		const parentId = task.parentId === null ? null : (taskMerge.survivorOf.get(task.parentId) ?? task.parentId);
		const movedTo = task.projectId === null ? null : projectOf(task.projectId);
		const projectId = movedTo !== null && projects.has(movedTo) ? movedTo : null;
		const labelIds = [
			...new Set(task.labelIds.map(id => labelMerge.survivorOf.get(id) ?? id).filter(id => labels.has(id))),
		];
		return { ...task, parentId, projectId, labelIds };
	});
	tasks = detachOrphans(tasks);
	tasks = takeRootProject(tasks);
	tasks = reopenAncestors(tasks);

	return { ...snapshot, tasks, projects: byName.kept, labels: labelMerge.kept };
}

/** Keeps the oldest of each group sharing a key and maps every dropped id to its survivor. */
function mergeDuplicates<T extends { id: string; createdAt: number }>(
	items: readonly T[],
	keyOf: (item: T) => string | undefined,
): { kept: T[]; survivorOf: Map<string, string> } {
	const survivors = new Map<string, T>();
	for (const item of items.toSorted(byCreation)) {
		const key = keyOf(item);
		if (key !== undefined && !survivors.has(key)) survivors.set(key, item);
	}
	const survivorOf = new Map<string, string>();
	const kept = items.filter(item => {
		const key = keyOf(item);
		const survivor = key === undefined ? item : survivors.get(key)!;
		if (survivor !== item) survivorOf.set(item.id, survivor.id);
		return survivor === item;
	});
	return { kept, survivorOf };
}

function rootOf(byId: ReadonlyMap<string, Task>, task: Task): Task {
	let root = task;
	for (let parent = byId.get(root.parentId ?? ''); parent; parent = byId.get(parent.parentId ?? '')) root = parent;
	return root;
}

function takeRootProject(tasks: readonly Task[]): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	return tasks.map(task => {
		const projectId = rootOf(byId, task).projectId;
		return task.projectId === projectId ? task : { ...task, projectId };
	});
}

function reopenAncestors(tasks: readonly Task[]): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const reopen = new Set<string>();
	for (const task of tasks) {
		if (task.completedAt !== null) continue;
		for (let parent = byId.get(task.parentId ?? ''); parent; parent = byId.get(parent.parentId ?? '')) {
			if (parent.completedAt !== null) reopen.add(parent.id);
		}
	}
	return tasks.map(task => (reopen.has(task.id) ? { ...task, completedAt: null } : task));
}
