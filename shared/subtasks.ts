import { bySiblingOrder, moveOrders } from './sync/order.ts';
import { nextOccurrence, type DateKey, type Due, type Task } from './task.ts';

/**
 * Subtasks are tasks with a `parentId`, nested to any depth. Every command here keeps two invariants:
 * an open task never sits under a completed one, and a subtask shares its root task's project.
 * Commands return the new versions of the tasks they change, so the caller can keep the old ones for undo.
 */

export type Progress = { done: number; total: number };

export type Completion = { kind: 'done'; changed: Task[] } | { kind: 'rolled'; next: Due; changed: Task[] };

/** Each parent's children in sibling order. */
export function groupChildren(tasks: readonly Task[]): Map<string, Task[]> {
	const groups = new Map<string, Task[]>();
	for (const task of tasks) {
		if (task.parentId === null) continue;
		const siblings = groups.get(task.parentId) ?? [];
		siblings.push(task);
		groups.set(task.parentId, siblings);
	}
	for (const siblings of groups.values()) siblings.sort(bySiblingOrder);
	return groups;
}

export function descendantsOf(tasks: readonly Task[], id: string): Task[] {
	const children = groupChildren(tasks);
	const out: Task[] = [];
	const queue = [id];
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		for (const child of children.get(next) ?? []) {
			out.push(child);
			queue.push(child.id);
		}
	}
	return out;
}

/** From the root down to the task's parent. */
export function ancestorsOf(tasks: readonly Task[], id: string): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const out: Task[] = [];
	for (let parent = byId.get(byId.get(id)?.parentId ?? ''); parent; parent = byId.get(parent.parentId ?? '')) {
		out.unshift(parent);
	}
	return out;
}

/** Counts direct children, or null for a task without any. */
export function progressOf(children: readonly Task[]): Progress | null {
	if (!children.length) return null;
	return { done: children.filter(c => c.completedAt !== null).length, total: children.length };
}

export function nextSiblingOrder(tasks: readonly Task[], parentId: string): number {
	return Math.max(-1, ...tasks.filter(t => t.parentId === parentId).map(t => t.order)) + 1;
}

/**
 * Completing a task completes every open subtask under it. A recurring task moves to its next occurrence
 * instead, and every subtask under it reopens, so each occurrence starts with a fresh checklist.
 */
export function completeTask(tasks: readonly Task[], id: string, today: DateKey, now: number): Completion | null {
	const task = tasks.find(t => t.id === id);
	if (!task) return null;
	const descendants = descendantsOf(tasks, id);
	const next = nextOccurrence(task, today);
	if (!next) {
		const changed = [task, ...descendants].filter(t => t.completedAt === null).map(t => ({ ...t, completedAt: now }));
		return { kind: 'done', changed };
	}
	const reopened = descendants.filter(t => t.completedAt !== null).map(t => ({ ...t, completedAt: null }));
	return { kind: 'rolled', next: next.due, changed: [{ ...task, ...next }, ...reopened] };
}

/** Reopening a subtask reopens every completed task above it. */
export function reopenTask(tasks: readonly Task[], id: string): Task[] {
	const task = tasks.find(t => t.id === id);
	if (!task) return [];
	return [...ancestorsOf(tasks, id), task].filter(t => t.completedAt !== null).map(t => ({ ...t, completedAt: null }));
}

/**
 * Moves a subtask to `index` among its siblings by writing only its own fractional `order`, so concurrent moves of
 * different siblings never overwrite each other. It renumbers the siblings only when the gap gets too small.
 */
export function moveSubtask(tasks: readonly Task[], id: string, index: number): Task[] {
	const task = tasks.find(t => t.id === id);
	if (!task?.parentId) return [];
	const siblings = new Map(tasks.filter(t => t.parentId === task.parentId).map(t => [t.id, t]));
	return moveOrders([...siblings.values()], id, index).map(({ id, order }) => ({ ...siblings.get(id)!, order }));
}

/** Makes a task whose parent is missing, or whose parents loop back to it, a top-level task, so it never goes unreachable. */
export function detachOrphans(tasks: readonly Task[]): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const reachesRoot = (task: Task) => {
		const seen = new Set([task.id]);
		for (let id = task.parentId; id !== null; id = byId.get(id)!.parentId) {
			if (!byId.has(id) || seen.has(id)) return false;
			seen.add(id);
		}
		return true;
	};
	return tasks.map(t => (reachesRoot(t) ? t : { ...t, parentId: null }));
}
