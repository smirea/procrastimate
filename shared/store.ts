import * as subtasks from './subtasks.ts';
import {
	DEFAULT_PRIORITY,
	type DateKey,
	type Due,
	type Label,
	type Priority,
	type Project,
	type Recurrence,
	type Reminder,
	type Task,
} from './task.ts';

/**
 * The store's commands as pure functions over its data, so the web store and the Swift store apply the same
 * rules. Each returns new arrays and new objects for what it changes and leaves its input untouched.
 */
export type StoreData = { tasks: Task[]; projects: Project[]; labels: Label[] };

/** What the caller supplies for a new record, so the rules stay deterministic. */
export type Creation = { id: string; now: number };

export type NewTask = {
	title: string;
	projectId: string | null;
	labelIds: string[];
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
};

export type TaskPatch = Partial<
	Pick<Task, 'title' | 'notes' | 'projectId' | 'labelIds' | 'due' | 'recurrence' | 'priority' | 'reminders'>
>;

/** The fields a completion changes. Undo writes back only these, so edits made since then survive it. */
export type CompletionState = Pick<Task, 'id' | 'completedAt' | 'due' | 'reminders'>;

/** `previous` holds every task the completion changed, as it was, so undo can put them back. */
export type Completion = ({ kind: 'done' } | { kind: 'rolled'; next: Due }) & { previous: CompletionState[] };

const byCreation = (a: Task, b: Task) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Tasks stay sorted by `createdAt`, then `id`, so every client and the sync server agree on one order. */
export const sortTasks = (tasks: readonly Task[]) => tasks.toSorted(byCreation);

/** Writes each value over the fields of the task with its id. */
function put(tasks: readonly Task[], changed: readonly (Partial<Task> & Pick<Task, 'id'>)[]): Task[] {
	if (!changed.length) return [...tasks];
	const byId = new Map(changed.map(c => [c.id, c]));
	return tasks.map(t => {
		const next = byId.get(t.id);
		return next ? { ...t, ...next } : t;
	});
}

/**
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
	const task: Task = {
		id,
		parentId: parent?.id ?? null,
		order: parent ? subtasks.nextSiblingOrder(data.tasks, parent.id) : 0,
		title: input.title,
		notes: '',
		projectId: parent ? parent.projectId : input.projectId,
		labelIds: input.labelIds,
		due: input.due,
		recurrence: input.recurrence,
		priority: input.priority ?? DEFAULT_PRIORITY,
		reminders: input.reminders,
		createdAt: Math.max(now, (data.tasks.at(-1)?.createdAt ?? -Infinity) + 1),
		completedAt: null,
	};
	let tasks = [...data.tasks, task];
	if (parent) tasks = put(tasks, subtasks.reopenTask(tasks, parent.id));
	return { data: { ...data, tasks }, task };
}

/** A new project applies to every subtask under the task too. */
export function updateTask(data: StoreData, id: string, patch: TaskPatch): StoreData {
	if (!data.tasks.some(t => t.id === id)) return data;
	const changed: (Partial<Task> & Pick<Task, 'id'>)[] = [{ ...patch, id }];
	if (patch.projectId !== undefined) {
		for (const t of subtasks.descendantsOf(data.tasks, id)) changed.push({ id: t.id, projectId: patch.projectId });
	}
	return { ...data, tasks: put(data.tasks, changed) };
}

export function completeTask(
	data: StoreData,
	id: string,
	today: DateKey,
	now: number,
): { data: StoreData; completion: Completion } | null {
	const result = subtasks.completeTask(data.tasks, id, today, now);
	if (!result) return null;
	const byId = new Map(data.tasks.map(t => [t.id, t]));
	const previous = result.changed.map(({ id }) => {
		const { completedAt, due, reminders } = byId.get(id)!;
		return { id, completedAt, due, reminders };
	});
	const completion: Completion =
		result.kind === 'done' ? { kind: 'done', previous } : { kind: 'rolled', next: result.next, previous };
	return { data: { ...data, tasks: put(data.tasks, result.changed) }, completion };
}

export function reopenTask(data: StoreData, id: string): StoreData {
	return { ...data, tasks: put(data.tasks, subtasks.reopenTask(data.tasks, id)) };
}

/** Puts back what a completion changed, as its undo captured it. */
export function restoreCompletion(data: StoreData, previous: readonly CompletionState[]): StoreData {
	return { ...data, tasks: put(data.tasks, previous) };
}

export function moveSubtask(data: StoreData, id: string, index: number): StoreData {
	return { ...data, tasks: put(data.tasks, subtasks.moveSubtask(data.tasks, id, index)) };
}

/** Deletes the task with every subtask under it, and returns them for undo. */
export function deleteTask(data: StoreData, id: string): { data: StoreData; removed: Task[] } {
	const task = data.tasks.find(t => t.id === id);
	if (!task) return { data, removed: [] };
	const removed = [task, ...subtasks.descendantsOf(data.tasks, id)];
	const ids = new Set(removed.map(t => t.id));
	return { data: { ...data, tasks: data.tasks.filter(t => !ids.has(t.id)) }, removed };
}

export function undeleteTasks(data: StoreData, removed: readonly Task[]): StoreData {
	const ids = new Set(data.tasks.map(t => t.id));
	return { ...data, tasks: sortTasks([...data.tasks, ...removed.filter(t => !ids.has(t.id))]) };
}

export function addProject(
	data: StoreData,
	name: string,
	{ id, now }: Creation,
): { data: StoreData; project: Project } {
	const project: Project = { id, name, createdAt: now };
	return { data: { ...data, projects: [...data.projects, project] }, project };
}

export function renameProject(data: StoreData, id: string, name: string): StoreData {
	return { ...data, projects: data.projects.map(p => (p.id === id ? { ...p, name } : p)) };
}

/** Deleting a project deletes its tasks, subtasks included, since they share their root's project. */
export function deleteProject(data: StoreData, id: string): StoreData {
	return {
		...data,
		projects: data.projects.filter(p => p.id !== id),
		tasks: data.tasks.filter(t => t.projectId !== id),
	};
}

export function addLabel(data: StoreData, name: string, { id, now }: Creation): { data: StoreData; label: Label } {
	const label: Label = { id, name, createdAt: now };
	return { data: { ...data, labels: [...data.labels, label] }, label };
}

/** Names stay unique ignoring case, since `@name` must resolve to one label. */
export function renameLabel(data: StoreData, id: string, name: string): StoreData {
	const taken = data.labels.some(l => l.id !== id && l.name.toLowerCase() === name.toLowerCase());
	if (taken) return data;
	return { ...data, labels: data.labels.map(l => (l.id === id ? { ...l, name } : l)) };
}

/** Unlike a project, a label owns no tasks, so deleting it only takes it off them. */
export function deleteLabel(data: StoreData, id: string): StoreData {
	return {
		...data,
		labels: data.labels.filter(l => l.id !== id),
		tasks: data.tasks.map(t => (t.labelIds.includes(id) ? { ...t, labelIds: t.labelIds.filter(l => l !== id) } : t)),
	};
}
