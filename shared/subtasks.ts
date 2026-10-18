import { z } from 'zod';
import { bySiblingOrder, moveOrders } from './order.ts';
import { taskSchema } from './model.ts';
import { dueSchema } from './values.ts';
import { nextOccurrence, type DateKey, type Due, type Task } from './task.ts';
import { currentOccurrence, occurrenceDue } from './triggers.ts';

/**
 * Subtasks are tasks with a `parentId`, nested to any depth. Every command here keeps two invariants:
 * an open task never sits under a completed one, and a subtask shares its root task's project.
 * Commands return the new versions of the tasks they change, so the caller can keep the old ones for undo.
 */

export const progressSchema = z
	.object({ done: z.number().int(), total: z.number().int() })
	.meta({ id: 'SubtaskProgress' });
export type Progress = z.infer<typeof progressSchema>;

export const subtaskCompletionSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('done'), changed: z.array(taskSchema) }),
		z.object({ kind: z.literal('rolled'), next: dueSchema, changed: z.array(taskSchema) }),
	])
	.meta({ id: 'SubtaskCompletion', 'x-inline': true });
export type Completion = z.infer<typeof subtaskCompletionSchema>;

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

export function ancestorsOf(tasks: readonly Task[], id: string): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const out: Task[] = [];
	for (let parent = byId.get(byId.get(id)?.parentId ?? ''); parent; parent = byId.get(parent.parentId ?? '')) {
		out.unshift(parent);
	}
	return out;
}

export function progressOf(children: readonly Task[]): Progress | null {
	if (!children.length) return null;
	return { done: children.filter(c => c.completedAt !== null).length, total: children.length };
}

export function nextSiblingOrder(tasks: readonly Task[], parentId: string): number {
	return Math.max(-1, ...tasks.filter(t => t.parentId === parentId).map(t => t.order)) + 1;
}

/**
 * A task on an event series moves past the occurrence it is on, and any missed before it, to the next one the
 * calendar listed. With none left it completes, until iOS lists more.
 */
function nextEventOccurrence(task: Task, today: DateKey): { next: Due; fields: Pick<Task, 'event'> } | null {
	const event = task.event;
	if (!event?.series) return null;
	const rest = event.occurrences.slice(event.occurrences.indexOf(currentOccurrence(event, today)) + 1);
	if (!rest.length) return null;
	return { next: occurrenceDue(event, rest[0]!), fields: { event: { ...event, occurrences: rest } } };
}

/**
 * Completing a task completes every open subtask under it. A recurring task, or one on an event series, moves to its
 * next occurrence instead, and every subtask under it reopens, so each occurrence starts with a fresh checklist.
 * Either way the task's `lastCompletedAt` becomes `now`, which is what tells a roll apart from a postpone.
 */
export function completeTask(tasks: readonly Task[], id: string, today: DateKey, now: number): Completion | null {
	const task = tasks.find(t => t.id === id);
	if (!task) return null;
	const descendants = descendantsOf(tasks, id);
	const occurrence = nextOccurrence(task, today);
	const series = nextEventOccurrence(task, today);
	const next = occurrence ? { next: occurrence.due, fields: occurrence } : series;
	if (!next) {
		const changed = [task, ...descendants]
			.filter(t => t.completedAt === null)
			.map(t => (t.id === id ? { ...t, completedAt: now, lastCompletedAt: now } : { ...t, completedAt: now }));
		return { kind: 'done', changed };
	}
	const reopened = descendants.filter(t => t.completedAt !== null).map(t => ({ ...t, completedAt: null }));
	return {
		kind: 'rolled',
		next: next.next,
		changed: [{ ...task, ...next.fields, lastCompletedAt: now }, ...reopened],
	};
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
