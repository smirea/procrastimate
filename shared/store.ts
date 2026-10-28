import { z } from 'zod';
import { defaultLabelColor, type LabelColor } from './label-colors.ts';
import type { ProjectIcon } from './project-icons.ts';
import * as subtasks from './subtasks.ts';
import { bySiblingOrder, moveOrders } from './order.ts';
import { labelSchema, projectSchema, sectionSchema, snapshotSchema, taskSchema } from './model.ts';
import { DEFAULT_PRIORITY, type DateKey, type Label, type Project, type Section, type Task } from './task.ts';
import { byCreation } from './snapshot.ts';
import { placeKey } from './triggers.ts';
import { imageRefSchema, type SavedPlace, type SectionCounter, type TaskLocation } from './values.ts';

/**
 * The store's commands as pure functions over its data, so the web store and the Swift store apply the same
 * rules. Each returns new arrays and new objects for what it changes and leaves its input untouched.
 */
export const storeDataSchema = snapshotSchema.omit({ settings: true }).meta({
	id: 'StoreData',
	description: 'Everything the store holds that syncs: tasks, projects, sections, labels, comments, and read markers.',
});
export type StoreData = z.infer<typeof storeDataSchema>;

export const creationSchema = z
	.object({ id: z.string(), now: z.number().int().meta({ description: 'Epoch milliseconds.' }) })
	.meta({ id: 'Creation', description: 'What the caller supplies for a new record, so the rules stay deterministic.' });
export type Creation = z.infer<typeof creationSchema>;

const taskShape = taskSchema.shape;

export const newTaskSchema = z
	.object({
		title: taskShape.title,
		projectId: taskShape.projectId,
		sectionId: taskShape.sectionId
			.default(null)
			.meta({ description: 'A section puts the task in its project. A subtask gets none.' }),
		labelIds: taskShape.labelIds,
		due: taskShape.due,
		recurrence: taskShape.recurrence,
		priority: taskShape.priority.nullable(),
		reminders: taskShape.reminders,
		location: taskShape.location.default(null),
		event: taskShape.event.default(null),
	})
	.meta({ id: 'NewTask' });
export type NewTask = z.input<typeof newTaskSchema>;

export const taskEditSchema = taskSchema
	.pick({
		title: true,
		notes: true,
		projectId: true,
		sectionId: true,
		labelIds: true,
		due: true,
		recurrence: true,
		priority: true,
		reminders: true,
		location: true,
		event: true,
		images: true,
	})
	.partial()
	.refine(patch => !(patch.event && (patch.due || patch.recurrence)), {
		message: 'An event stands in for the date and the repeat',
	})
	.meta({
		id: 'TaskEdit',
		description:
			'The editable fields of a task. A missing field is left alone; for nullable fields, `null` clears the value. A section moves the task into its project, and a new project without one leaves the task in no section.',
	});
export type TaskPatch = z.infer<typeof taskEditSchema>;

export const completionStateSchema = z
	.object({
		id: taskShape.id,
		completedAt: taskShape.completedAt,
		lastCompletedAt: taskShape.lastCompletedAt,
		due: taskShape.due,
		reminders: taskShape.reminders,
		event: taskShape.event,
	})
	.meta({
		id: 'CompletionState',
		description: 'The fields a completion changes. Undo writes back only these, so edits made since then survive it.',
	});
export type CompletionState = z.infer<typeof completionStateSchema>;

export const completionSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('done'), previous: z.array(completionStateSchema) }),
		z.object({ kind: z.literal('rolled'), next: taskShape.due.unwrap(), previous: z.array(completionStateSchema) }),
	])
	.meta({
		id: 'Completion',
		description: '`previous` holds every task the completion changed, as it was, so undo can put them back.',
		'x-flatten': { kind: 'CompletionKind' },
	});
export type Completion = z.infer<typeof completionSchema>;

export const completionKindSchema = z.enum(['done', 'rolled']).meta({ id: 'CompletionKind' });

export const explodeMethodSchema = z.enum(['direct', 'prefix', 'inherit']).meta({
	id: 'ExplodeMethod',
	description:
		"How subtasks become tasks: `direct` keeps their titles, `prefix` puts the parent's title before each, as in `Parent: child`, and `inherit` fills in the parent's labels, date, and priority where a subtask has none.",
});
export type ExplodeMethod = z.infer<typeof explodeMethodSchema>;

export const explodedStateSchema = taskSchema
	.pick({
		id: true,
		parentId: true,
		order: true,
		sectionId: true,
		title: true,
		labelIds: true,
		due: true,
		priority: true,
	})
	.meta({
		id: 'ExplodedState',
		description: 'The fields exploding subtasks changes, as they were. Undo writes back only these.',
	});
export type ExplodedState = z.infer<typeof explodedStateSchema>;

export const deletedSchema = z
	.object({
		projects: z.array(projectSchema),
		sections: z.array(sectionSchema),
		labels: z.array(labelSchema),
		tasks: z.array(taskSchema),
		labelings: z.array(
			z.object({ taskId: z.string(), labelId: z.string(), index: z.number().int() }).meta({
				id: 'Labeling',
				description: 'A label taken off a task that stayed, with where it sat in `labelIds`.',
			}),
		),
	})
	.meta({
		id: 'Deleted',
		description:
			'What a delete removed, as it was, so undo can put it back. While its undo is pending, other undos apply to these records too.',
	});
export type Deleted = z.infer<typeof deletedSchema>;

/** Tasks stay sorted by `createdAt`, then `id`, so every client and the sync server agree on one order. */
export const sortTasks = (tasks: readonly Task[]) => tasks.toSorted(byCreation);

function put(tasks: readonly Task[], changed: readonly (Partial<Task> & Pick<Task, 'id'>)[]): Task[] {
	if (!changed.length) return [...tasks];
	const byId = new Map(changed.map(c => [c.id, c]));
	return tasks.map(t => {
		const next = byId.get(t.id);
		return next ? { ...t, ...next } : t;
	});
}

/**
 * A section puts a top-level task in that section and its project, as in `updateTask`.
 * With a `parentId`, adds the task as that parent's last subtask, in its project, and reopens the parent if it is done.
 * Adding rows in their source order with each row's parent reproduces an outline's nesting and order. `createdAt` is
 * at least one past the newest task's, so tasks added within one millisecond, or under a frozen clock, keep the order
 * they were added in instead of falling back to their random ids.
 */
export function addTask(
	data: StoreData,
	input: NewTask,
	parentId: string | null,
	{ id, now }: Creation,
): { data: StoreData; task: Task } {
	const parent = parentId ? data.tasks.find(t => t.id === parentId) : undefined;
	const section = parent || !input.sectionId ? undefined : data.sections.find(s => s.id === input.sectionId);
	const task: Task = {
		id,
		parentId: parent?.id ?? null,
		order: parent ? subtasks.nextSiblingOrder(data.tasks, parent.id) : 0,
		title: input.title,
		notes: '',
		projectId: parent ? parent.projectId : (section?.projectId ?? input.projectId),
		sectionId: section?.id ?? null,
		labelIds: input.labelIds,
		due: input.due,
		recurrence: input.recurrence,
		priority: input.priority ?? DEFAULT_PRIORITY,
		reminders: input.reminders,
		location: input.location ?? null,
		event: input.event ?? null,
		images: [],
		createdAt: Math.max(now, (data.tasks.at(-1)?.createdAt ?? -Infinity) + 1),
		completedAt: null,
		createdBy: null,
		completedBy: null,
		lastCompletedAt: null,
	};
	let tasks = [...data.tasks, task];
	if (parent) tasks = put(tasks, subtasks.reopenTask(tasks, parent.id));
	return { data: { ...data, tasks }, task };
}

/**
 * A section moves a top-level task into the section's project, and a new project without a section leaves it in none.
 * Only top-level tasks sit in a section; a subtask shows under its parent. A new project applies to every subtask
 * under the task too.
 */
export function updateTask(data: StoreData, id: string, patch: TaskPatch): StoreData {
	const task = data.tasks.find(t => t.id === id);
	if (!task) return data;
	let next: Partial<Task> & Pick<Task, 'id'> = { ...patch, id };
	if (patch.event) next = { ...next, due: null, recurrence: null };
	if (patch.sectionId !== undefined || (patch.projectId !== undefined && patch.projectId !== task.projectId)) {
		const section = patch.sectionId ? data.sections.find(s => s.id === patch.sectionId) : undefined;
		const asked = patch.projectId === undefined ? task.projectId : patch.projectId;
		const projectId = section && task.parentId === null ? section.projectId : asked;
		next = { ...next, projectId, sectionId: task.parentId === null ? (section?.id ?? null) : null };
	}
	const changed = [next];
	if (next.projectId !== undefined) {
		for (const t of subtasks.descendantsOf(data.tasks, id)) changed.push({ id: t.id, projectId: next.projectId });
	}
	return { ...data, tasks: put(data.tasks, changed) };
}

export function completeTask(
	data: StoreData,
	id: string,
	today: DateKey,
	now: number,
	zone?: string,
): { data: StoreData; completion: Completion } | null {
	const result = subtasks.completeTask(data.tasks, id, today, now, zone);
	if (!result) return null;
	const byId = new Map(data.tasks.map(t => [t.id, t]));
	const previous = result.changed.map(({ id }) => {
		const { completedAt, lastCompletedAt, due, reminders, event } = byId.get(id)!;
		return { id, completedAt, lastCompletedAt, due, reminders, event };
	});
	const completion: Completion =
		result.kind === 'done' ? { kind: 'done', previous } : { kind: 'rolled', next: result.next, previous };
	return { data: { ...data, tasks: put(data.tasks, result.changed) }, completion };
}

export const reopenedTaskSchema = taskSchema.pick({ id: true, completedAt: true }).meta({
	id: 'ReopenedTask',
	description: 'A task a reopen cleared, with the `completedAt` it had, so undo can put it back.',
});
export type ReopenedTask = z.infer<typeof reopenedTaskSchema>;

/** `reopened` is each task that was completed, with its `completedAt`, so undo can put the completions back. */
export function reopenTask(data: StoreData, id: string): { data: StoreData; reopened: ReopenedTask[] } {
	const changed = subtasks.reopenTask(data.tasks, id);
	const before = new Map(data.tasks.map(t => [t.id, t.completedAt]));
	return {
		data: { ...data, tasks: put(data.tasks, changed) },
		reopened: changed.map(t => ({ id: t.id, completedAt: before.get(t.id)! })),
	};
}

export function restoreCompletion(data: StoreData, previous: readonly CompletionState[]): StoreData {
	return { ...data, tasks: put(data.tasks, previous) };
}

export function moveSubtask(data: StoreData, id: string, index: number): StoreData {
	return { ...data, tasks: put(data.tasks, subtasks.moveSubtask(data.tasks, id, index)) };
}

export function deleteTask(data: StoreData, id: string): { data: StoreData; removed: Task[] } {
	const task = data.tasks.find(t => t.id === id);
	if (!task) return { data, removed: [] };
	const removed = [task, ...subtasks.descendantsOf(data.tasks, id)];
	const ids = new Set(removed.map(t => t.id));
	return { data: { ...data, tasks: data.tasks.filter(t => !ids.has(t.id)) }, removed };
}

/**
 * Turns a task's direct subtasks into tasks of their own, one level up: top-level tasks for a top-level parent, else
 * siblings right after it, in their order. Each keeps its own subtasks. The parent stays, without them. Returns the
 * subtasks as they were, for undo.
 */
export function explodeSubtasks(
	data: StoreData,
	id: string,
	method: ExplodeMethod,
): { data: StoreData; previous: ExplodedState[] } {
	const parent = data.tasks.find(t => t.id === id);
	const children = subtasks.groupChildren(data.tasks).get(id) ?? [];
	if (!parent || !children.length) return { data, previous: [] };
	const nextOrder = parent.parentId
		? (data.tasks
				.filter(t => t.parentId === parent.parentId && t.id !== id && bySiblingOrder(t, parent) > 0)
				.toSorted(bySiblingOrder)[0]?.order ?? null)
		: null;
	const gap = nextOrder === null ? children.length + 1 : nextOrder - parent.order;
	const orderAt = (index: number) => (parent.parentId ? parent.order + ((index + 1) * gap) / (children.length + 1) : 0);
	const changed = children.map((child, index): Task => {
		// Children of a top-level task land beside it, in its section.
		const sectionId = parent.parentId === null ? parent.sectionId : null;
		const moved = { ...child, parentId: parent.parentId, order: orderAt(index), sectionId };
		if (method === 'prefix') return { ...moved, title: `${parent.title}: ${child.title}` };
		if (method === 'direct') return moved;
		return {
			...moved,
			labelIds: child.labelIds.length ? child.labelIds : parent.labelIds,
			due: child.due === null && child.event === null ? parent.due : child.due,
			priority: child.priority === DEFAULT_PRIORITY ? parent.priority : child.priority,
		};
	});
	const previous = children.map(({ id, parentId, order, sectionId, title, labelIds, due, priority }) => ({
		id,
		parentId,
		order,
		sectionId,
		title,
		labelIds,
		due,
		priority,
	}));
	return { data: { ...data, tasks: put(data.tasks, changed) }, previous };
}

/** A subtask whose parent was deleted since stays where it is, so it never goes unreachable. */
export function restoreExploded(data: StoreData, previous: readonly ExplodedState[]): StoreData {
	const ids = new Set(data.tasks.map(t => t.id));
	const restored = previous.map(({ parentId, order, sectionId, ...state }) =>
		parentId === null || ids.has(parentId) ? { ...state, parentId, order, sectionId } : state,
	);
	return { ...data, tasks: put(data.tasks, restored) };
}

/** A taken name, ignoring case, returns the project that has it, since `#name` must resolve to one project. */
export function addProject(
	data: StoreData,
	name: string,
	{ id, now }: Creation,
): { data: StoreData; project: Project } {
	const existing = data.projects.find(p => sameName(p.name, name));
	if (existing) return { data, project: existing };
	const last = projectsInOrder(data.projects).at(-1);
	const project: Project = { id, name, order: last ? last.order + 1 : 0, icon: null, createdAt: now };
	return { data: { ...data, projects: [...data.projects, project] }, project };
}

/** The stored list stays in creation order, like every synced list. */
export const projectsInOrder = (projects: readonly Project[]) => projects.toSorted(bySiblingOrder);

export function moveProject(data: StoreData, id: string, index: number): StoreData {
	const orders = new Map(moveOrders(data.projects, id, index).map(o => [o.id, o.order]));
	if (!orders.size) return data;
	return { ...data, projects: data.projects.map(p => (orders.has(p.id) ? { ...p, order: orders.get(p.id)! } : p)) };
}

/** A rename to another project's name, ignoring case, changes nothing. */
export function renameProject(data: StoreData, id: string, name: string): StoreData {
	if (data.projects.some(p => p.id !== id && sameName(p.name, name))) return data;
	return { ...data, projects: data.projects.map(p => (p.id === id ? { ...p, name } : p)) };
}

export function setProjectIcon(data: StoreData, id: string, icon: ProjectIcon | null): StoreData {
	return { ...data, projects: data.projects.map(p => (p.id === id ? { ...p, icon } : p)) };
}

/** Deleting a project deletes its sections and tasks, subtasks included, since they share their root's project. */
export function deleteProject(data: StoreData, id: string): StoreData {
	return {
		...data,
		projects: data.projects.filter(p => p.id !== id),
		sections: data.sections.filter(s => s.projectId !== id),
		tasks: data.tasks.filter(t => t.projectId !== id),
	};
}

export const sectionsOf = (sections: readonly Section[], projectId: string) =>
	sections.filter(s => s.projectId === projectId).toSorted(bySiblingOrder);

/** Names are unique ignoring case, since `#name`, `/name`, and `@name` must each resolve to one record. */
export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const takenIn = (data: StoreData, projectId: string, name: string, except?: string) =>
	data.sections.some(s => s.id !== except && s.projectId === projectId && sameName(s.name, name));

/**
 * Adds a section last in its project. Names stay unique in a project ignoring case, since `/name` must resolve to one
 * section, so a taken name returns the section that has it.
 */
export function addSection(
	data: StoreData,
	projectId: string,
	name: string,
	{ id, now }: Creation,
): { data: StoreData; section: Section } {
	const existing = data.sections.find(s => s.projectId === projectId && sameName(s.name, name));
	if (existing) return { data, section: existing };
	const last = sectionsOf(data.sections, projectId).at(-1);
	const section: Section = { id, projectId, name, order: last ? last.order + 1 : 0, counter: 'quiet', createdAt: now };
	return { data: { ...data, sections: [...data.sections, section] }, section };
}

export function renameSection(data: StoreData, id: string, name: string): StoreData {
	const section = data.sections.find(s => s.id === id);
	if (!section || takenIn(data, section.projectId, name, id)) return data;
	return { ...data, sections: data.sections.map(s => (s.id === id ? { ...s, name } : s)) };
}

export function setSectionCounter(data: StoreData, id: string, counter: SectionCounter): StoreData {
	return { ...data, sections: data.sections.map(s => (s.id === id ? { ...s, counter } : s)) };
}

export function moveSection(data: StoreData, id: string, index: number): StoreData {
	const section = data.sections.find(s => s.id === id);
	if (!section) return data;
	const orders = new Map(moveOrders(sectionsOf(data.sections, section.projectId), id, index).map(o => [o.id, o.order]));
	if (!orders.size) return data;
	return { ...data, sections: data.sections.map(s => (orders.has(s.id) ? { ...s, order: orders.get(s.id)! } : s)) };
}

/** Every task in a section, done ones and subtasks included: what deleting it removes, so its prompt can count them. */
export function sectionTasks(tasks: readonly Task[], id: string): Task[] {
	const children = subtasks.groupChildren(tasks);
	return tasks.filter(t => t.sectionId === id).flatMap(t => [t, ...subtasks.descendantsOf(tasks, t.id, children)]);
}

/** Deleting a section deletes its tasks with their subtasks, as Todoist does and as deleting a project does. */
export function deleteSection(data: StoreData, id: string): StoreData {
	const removed = new Set(sectionTasks(data.tasks, id).map(t => t.id));
	return {
		...data,
		sections: data.sections.filter(s => s.id !== id),
		tasks: data.tasks.filter(t => !removed.has(t.id)),
	};
}

export function deletedBetween(before: StoreData, after: StoreData): Deleted {
	const gone = <T extends { id: string }>(was: readonly T[], is: readonly T[]) => {
		const live = new Set(is.map(e => e.id));
		return was.filter(e => !live.has(e.id));
	};
	const kept = new Map(after.tasks.map(t => [t.id, t]));
	return {
		projects: gone(before.projects, after.projects),
		sections: gone(before.sections, after.sections),
		labels: gone(before.labels, after.labels),
		tasks: gone(before.tasks, after.tasks),
		labelings: before.tasks.flatMap(t => {
			const now = kept.get(t.id);
			if (!now) return [];
			return t.labelIds.flatMap((labelId, index) =>
				now.labelIds.includes(labelId) ? [] : [{ taskId: t.id, labelId, index }],
			);
		}),
	};
}

export const undoSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('completion'), previous: z.array(completionStateSchema) }),
		z.object({ kind: z.literal('reopen'), reopened: z.array(reopenedTaskSchema) }),
		z.object({ kind: z.literal('explode'), previous: z.array(explodedStateSchema) }),
		z.object({ kind: z.literal('postpone'), id: taskShape.id, due: taskShape.due }),
		z.object({ kind: z.literal('image'), taskId: taskShape.id, image: imageRefSchema, index: z.number().int() }),
		z.object({ kind: z.literal('delete'), deleted: deletedSchema }),
	])
	.meta({
		id: 'Undo',
		description:
			'What one undo puts back: only what its own action changed, so it merges onto the data as it is when it runs.',
	});
export type Undo = z.infer<typeof undoSchema>;

const heldLists = ['projects', 'sections', 'labels', 'tasks'] as const;

/** Each one goes in at its place in creation order, the order every synced list keeps. */
function insertByCreation<T extends { id: string; createdAt: number }>(live: readonly T[], added: readonly T[]): T[] {
	const list = [...live];
	const ids = new Set(live.map(e => e.id));
	for (const e of added) {
		if (ids.has(e.id)) continue;
		const at = list.findIndex(x => byCreation(x, e) > 0);
		list.splice(at === -1 ? list.length : at, 0, e);
	}
	return list;
}

/**
 * Puts the labels `pending[index]` released back where they sat, and recounts the other deletes' labelings around them.
 * Each delete counted its indexes on the task as it stood then, with older deletes' labels gone and newer ones' still
 * on, so replaying every pending delete newest first rebuilds the task's order from before the oldest. Taking the
 * released labels' places from that order, rather than their own indexes, keeps them right in any undo order.
 */
function relabel(
	data: StoreData,
	pending: readonly Undo[],
	index: number,
): { data: StoreData; labelings: Deleted['labelings'][] } {
	const labelings = pending.map(u => (u.kind === 'delete' ? u.deleted.labelings : []));
	const released = labelings[index]!;
	const orders = new Map<string, { full: string[]; now: string[] }>();
	const tasks = data.tasks.map(t => {
		const back = released.filter(l => l.taskId === t.id && !t.labelIds.includes(l.labelId)).map(l => l.labelId);
		if (!back.length) return t;
		const full = [...t.labelIds];
		for (const own of labelings.toReversed())
			for (const { labelId, index } of own.filter(l => l.taskId === t.id).toSorted((a, b) => a.index - b.index))
				if (!full.includes(labelId)) full.splice(Math.min(index, full.length), 0, labelId);
		const now = full.filter(id => t.labelIds.includes(id) || back.includes(id));
		orders.set(t.id, { full, now });
		return { ...t, labelIds: now };
	});
	const recounted = labelings.map((own, i) =>
		own.map(l => {
			const order = orders.get(l.taskId);
			if (!order || !order.full.includes(l.labelId)) return l;
			const newer = new Set(
				labelings.slice(i + 1).flatMap(n => n.filter(m => m.taskId === l.taskId).map(m => m.labelId)),
			);
			const on = (id: string) => order.now.includes(id) || newer.has(id);
			return { ...l, index: order.full.slice(0, order.full.indexOf(l.labelId)).filter(on).length };
		}),
	);
	return { data: { ...data, tasks }, labelings: recounted.filter((_, i) => i !== index) };
}

function applyUndo(data: StoreData, action: Undo): StoreData {
	switch (action.kind) {
		case 'completion':
			return restoreCompletion(data, action.previous);
		case 'reopen':
			return { ...data, tasks: put(data.tasks, action.reopened) };
		case 'explode':
			return restoreExploded(data, action.previous);
		case 'postpone':
			return { ...data, tasks: put(data.tasks, [{ id: action.id, due: action.due }]) };
		case 'image': {
			const { taskId, image, index } = action;
			const tasks = data.tasks.map(t =>
				t.id !== taskId || t.images.some(other => other.id === image.id)
					? t
					: { ...t, images: t.images.toSpliced(index, 0, image) },
			);
			return { ...data, tasks };
		}
		case 'delete':
			return data;
	}
}

export function undoTargets(action: Undo): string[] {
	switch (action.kind) {
		case 'completion':
		case 'explode':
			return action.previous.map(p => p.id);
		case 'reopen':
			return action.reopened.map(r => r.id);
		case 'postpone':
			return [action.id];
		case 'image':
			return [action.taskId];
		case 'delete':
			return heldLists.flatMap(list => action.deleted[list].map(e => e.id));
	}
}

/**
 * Takes `pending[index]`, one of the undos the user can still take, and returns the data and the undos left. A pending
 * delete holds what it removed, and an undo applies to those held records as to the live ones, so pending undos give
 * the same result in any order: undoing a label's delete puts the label back on a task whose own delete is pending.
 * A record an undo moves or brings back whose project, section, or parent task a pending delete holds joins that
 * delete, and comes back with it. One whose project, section, or parent is gone for good stays gone, so no task comes
 * back where no view shows it. A task edited since keeps its edits. A live task keeps only live labels: one a pending
 * delete holds goes into that delete's labelings, so undoing it puts the label back, and one gone for good is dropped.
 */
export function undo(data: StoreData, pending: readonly Undo[], index: number): { data: StoreData; pending: Undo[] } {
	const action = pending[index];
	const rest = pending.filter((_, i) => i !== index);
	if (!action) return { data, pending: rest };
	const holds = rest.map(u => (u.kind === 'delete' ? u.deleted : null));
	const owner = new Map<string, number>();
	holds.forEach((held, i) => {
		for (const list of heldLists) for (const e of held?.[list] ?? []) owner.set(e.id, i);
	});
	const released = action.kind === 'delete' ? action.deleted : null;
	const all = [...holds, released];
	const relabeled = relabel(
		{
			...data,
			projects: insertByCreation(
				data.projects,
				all.flatMap(held => held?.projects ?? []),
			),
			sections: insertByCreation(
				data.sections,
				all.flatMap(held => held?.sections ?? []),
			),
			labels: insertByCreation(
				data.labels,
				all.flatMap(held => held?.labels ?? []),
			),
			tasks: sortTasks(
				insertByCreation(
					data.tasks,
					all.flatMap(held => held?.tasks ?? []),
				),
			),
		},
		pending,
		index,
	);
	const after = applyUndo(relabeled.data, action);

	type Place = number | 'live' | 'gone';
	const targets = new Set(undoTargets(action));
	const projects = new Map(after.projects.map(p => [p.id, p]));
	const sections = new Map(after.sections.map(s => [s.id, s]));
	const tasks = new Map(after.tasks.map(t => [t.id, t]));
	const places = new Map<string, Place>();
	const placeOf = (e: Project | Section | Label | Task): Place => {
		let place = places.get(e.id);
		if (place !== undefined) return place;
		place = owner.get(e.id) ?? (targets.has(e.id) ? parentPlace(e) : followParent(e));
		places.set(e.id, place);
		return place;
	};
	// A subtask follows its parent into a pending delete, since the undo moved the parent with its whole subtree.
	const followParent = (e: Project | Section | Label | Task): Place => {
		const parent = 'parentId' in e && e.parentId !== null && !owner.has(e.parentId) ? tasks.get(e.parentId) : undefined;
		const place = parent ? placeOf(parent) : 'live';
		return typeof place === 'number' ? place : 'live';
	};
	const parentPlace = (e: Project | Section | Label | Task): Place => {
		const parents: [string | null, ReadonlyMap<string, Project | Section | Task>][] =
			'parentId' in e
				? [
						[e.projectId, projects],
						[e.sectionId, sections],
						[e.parentId, tasks],
					]
				: 'projectId' in e
					? [[e.projectId, projects]]
					: [];
		for (const [id, records] of parents) {
			if (id === null) continue;
			const parent = records.get(id);
			if (!parent) return released ? 'gone' : 'live';
			const place = placeOf(parent);
			if (place !== 'live') return place;
		}
		return 'live';
	};
	const at = (place: Place) => ({
		projects: after.projects.filter(e => placeOf(e) === place),
		sections: after.sections.filter(e => placeOf(e) === place),
		labels: after.labels.filter(e => placeOf(e) === place),
		tasks: after.tasks.filter(e => placeOf(e) === place),
	});
	const live = at('live');
	const liveLabels = new Set(live.labels.map(l => l.id));
	const moved = rest.map((): Deleted['labelings'] => []);
	live.tasks = live.tasks.map(t => {
		if (t.labelIds.every(id => liveLabels.has(id))) return t;
		// Each index is the one that delete would have recorded had the task been live, when the labels deleted after it
		// were still on the task, so undoing the label deletes newest first puts them back in their order.
		const since = (id: string, held: number) => liveLabels.has(id) || (owner.get(id) ?? -1) >= held;
		t.labelIds.forEach((labelId, at) => {
			const held = owner.get(labelId);
			if (liveLabels.has(labelId) || held === undefined) return;
			const index = t.labelIds.slice(0, at).filter(id => since(id, held)).length;
			moved[held]!.push({ taskId: t.id, labelId, index });
		});
		return { ...t, labelIds: t.labelIds.filter(id => liveLabels.has(id)) };
	});
	return {
		data: { ...data, ...live },
		pending: rest.map((u, i) =>
			u.kind === 'delete'
				? { ...u, deleted: { ...u.deleted, ...at(i), labelings: [...relabeled.labelings[i]!, ...moved[i]!] } }
				: u,
		),
	};
}

/** A taken name, ignoring case, returns the label that has it, since `@name` must resolve to one label. */
export function addLabel(data: StoreData, name: string, { id, now }: Creation): { data: StoreData; label: Label } {
	const existing = data.labels.find(l => sameName(l.name, name));
	if (existing) return { data, label: existing };
	const label: Label = { id, name, color: defaultLabelColor(name), place: null, createdAt: now };
	return { data: { ...data, labels: [...data.labels, label] }, label };
}

export function setLabelColor(data: StoreData, id: string, color: LabelColor): StoreData {
	return { ...data, labels: data.labels.map(l => (l.id === id ? { ...l, color } : l)) };
}

function relocate(tasks: readonly Task[], key: string, edit: Partial<TaskLocation>): Task[] {
	return tasks.map(t =>
		t.completedAt === null && t.location && placeKey(t.location) === key
			? { ...t, location: { ...t.location, ...edit } }
			: t,
	);
}

/**
 * Saves a place under a name, as a label that holds it. A name another label has is refused and returns no label,
 * since `@name` must resolve to one label. The open tasks already at the place take its name and radius.
 */
export function savePlace(
	data: StoreData,
	name: string,
	place: SavedPlace,
	{ id, now }: Creation,
): { data: StoreData; label: Label | null } {
	if (data.labels.some(l => sameName(l.name, name))) return { data, label: null };
	const label: Label = { id, name, color: defaultLabelColor(name), place, createdAt: now };
	const tasks = relocate(data.tasks, placeKey(place), { name, radius: place.radius });
	return { data: { ...data, labels: [...data.labels, label], tasks }, label };
}

/** A saved place's new radius reaches the open tasks at it, like saving it did. */
export function setPlaceRadius(data: StoreData, id: string, radius: number): StoreData {
	const label = data.labels.find(l => l.id === id);
	if (!label?.place) return data;
	return {
		...data,
		labels: data.labels.map(l => (l.id === id ? { ...l, place: { ...label.place!, radius } } : l)),
		tasks: relocate(data.tasks, placeKey(label.place), { radius }),
	};
}

/**
 * Names stay unique ignoring case, since `@name` must resolve to one label. Renaming a saved place renames it on the
 * open tasks at it.
 */
export function renameLabel(data: StoreData, id: string, name: string): StoreData {
	const taken = data.labels.some(l => l.id !== id && sameName(l.name, name));
	const label = data.labels.find(l => l.id === id);
	if (taken || !label) return data;
	return {
		...data,
		labels: data.labels.map(l => (l.id === id ? { ...l, name } : l)),
		tasks: label.place ? relocate(data.tasks, placeKey(label.place), { name }) : data.tasks,
	};
}

/** Unlike a project, a label owns no tasks, so deleting it only takes it off them. A deleted place stays on its tasks. */
export function deleteLabel(data: StoreData, id: string): StoreData {
	return {
		...data,
		labels: data.labels.filter(l => l.id !== id),
		tasks: data.tasks.map(t => (t.labelIds.includes(id) ? { ...t, labelIds: t.labelIds.filter(l => l !== id) } : t)),
	};
}
