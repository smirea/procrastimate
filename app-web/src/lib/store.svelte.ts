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
} from 'shared/task.ts';
import {
	completeTask,
	descendantsOf,
	groupChildren,
	moveSubtask,
	nextSiblingOrder,
	progressOf,
	reopenTask,
} from 'shared/subtasks.ts';
import { newId } from 'shared/id.ts';
import { loadSnapshot, saveSnapshot, type Snapshot } from './persistence.ts';

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

/** Every mutation is a discrete command that persists synchronously, so it can become a sync log later. */
class Store {
	tasks = $state<Task[]>([]);
	projects = $state<Project[]>([]);
	labels = $state<Label[]>([]);
	remindersCheckedAt = $state(0);
	#children = $derived(groupChildren(this.tasks));

	constructor() {
		if (typeof localStorage === 'undefined') return;
		const snapshot = loadSnapshot(Date.now());
		this.tasks = snapshot.tasks;
		this.projects = snapshot.projects;
		this.labels = snapshot.labels;
		this.remindersCheckedAt = snapshot.remindersCheckedAt;
	}

	#commit() {
		const snapshot: Snapshot = $state.snapshot({
			tasks: this.tasks,
			projects: this.projects,
			labels: this.labels,
			remindersCheckedAt: this.remindersCheckedAt,
		});
		saveSnapshot(snapshot);
	}

	/** Writes each value over the fields of the stored task with its id. */
	#put(changed: readonly (Partial<Task> & Pick<Task, 'id'>)[]) {
		for (const next of changed) {
			const task = this.task(next.id);
			if (task) Object.assign(task, next);
		}
		this.#commit();
	}

	task(id: string) {
		return this.tasks.find(t => t.id === id);
	}

	children(id: string): Task[] {
		return this.#children.get(id) ?? [];
	}

	progress(id: string) {
		return progressOf(this.children(id));
	}

	project(id: string | null) {
		return id ? this.projects.find(p => p.id === id) : undefined;
	}

	label(id: string) {
		return this.labels.find(l => l.id === id);
	}

	/** A task's labels in the order they were added, skipping any that were deleted. */
	labelsOf(task: Pick<Task, 'labelIds'>) {
		return task.labelIds.map(id => this.label(id)).filter(label => label !== undefined);
	}

	/**
	 * With a `parentId`, adds the task as that parent's last subtask, in its project, and reopens the parent if it is done.
	 * Adding rows in their source order with each row's parent reproduces an outline's nesting and order.
	 */
	addTask(input: NewTask, parentId: string | null = null): Task {
		const parent = parentId ? this.task(parentId) : undefined;
		const task: Task = {
			id: newId(),
			parentId: parent?.id ?? null,
			order: parent ? nextSiblingOrder(this.tasks, parent.id) : 0,
			title: input.title,
			notes: '',
			projectId: parent ? parent.projectId : input.projectId,
			labelIds: input.labelIds,
			due: input.due,
			recurrence: input.recurrence,
			priority: input.priority ?? DEFAULT_PRIORITY,
			reminders: input.reminders,
			createdAt: Date.now(),
			completedAt: null,
		};
		this.tasks.push(task);
		if (parent) this.#put(reopenTask(this.tasks, parent.id));
		this.#commit();
		return task;
	}

	/** A new project applies to every subtask under the task too. */
	updateTask(id: string, patch: TaskPatch) {
		const task = this.task(id);
		if (!task) return;
		Object.assign(task, patch);
		if (patch.projectId !== undefined) {
			for (const t of descendantsOf(this.tasks, id)) this.task(t.id)!.projectId = patch.projectId;
		}
		this.#commit();
	}

	completeTask(id: string, today: DateKey): Completion | undefined {
		const completion = completeTask(this.tasks, id, today, Date.now());
		if (!completion) return;
		const previous = completion.changed.map(({ id }) => {
			const { completedAt, due, reminders } = $state.snapshot(this.task(id)!);
			return { id, completedAt, due, reminders };
		});
		this.#put(completion.changed);
		return completion.kind === 'done'
			? { kind: 'done', previous }
			: { kind: 'rolled', next: completion.next, previous };
	}

	reopenTask(id: string) {
		this.#put(reopenTask(this.tasks, id));
	}

	/** Puts back what a completion changed, as its undo captured it. */
	restoreCompletion(previous: readonly CompletionState[]) {
		this.#put(previous);
	}

	moveSubtask(id: string, index: number) {
		this.#put(moveSubtask(this.tasks, id, index));
	}

	/** Deletes the task with every subtask under it, and returns them for undo. */
	deleteTask(id: string): Task[] {
		const task = this.task(id);
		if (!task) return [];
		const removed = $state.snapshot([task, ...descendantsOf(this.tasks, id)]);
		const ids = new Set(removed.map(t => t.id));
		this.tasks = this.tasks.filter(t => !ids.has(t.id));
		this.#commit();
		return removed;
	}

	undeleteTasks(removed: readonly Task[]) {
		this.tasks.push(...removed.filter(t => !this.task(t.id)));
		this.#commit();
	}

	addProject(name: string): Project {
		const project: Project = { id: newId(), name, createdAt: Date.now() };
		this.projects.push(project);
		this.#commit();
		return project;
	}

	renameProject(id: string, name: string) {
		const project = this.project(id);
		if (!project) return;
		project.name = name;
		this.#commit();
	}

	deleteProject(id: string) {
		this.projects = this.projects.filter(p => p.id !== id);
		this.tasks = this.tasks.filter(t => t.projectId !== id);
		this.#commit();
	}

	addLabel(name: string): Label {
		const label: Label = { id: newId(), name, createdAt: Date.now() };
		this.labels.push(label);
		this.#commit();
		return label;
	}

	/** Names stay unique ignoring case, since `@name` must resolve to one label. */
	renameLabel(id: string, name: string) {
		const label = this.label(id);
		if (!label || this.labels.some(l => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) return;
		label.name = name;
		this.#commit();
	}

	/** Unlike a project, a label owns no tasks, so deleting it only takes it off them. */
	deleteLabel(id: string) {
		this.labels = this.labels.filter(l => l.id !== id);
		for (const task of this.tasks) {
			if (task.labelIds.includes(id)) task.labelIds = task.labelIds.filter(l => l !== id);
		}
		this.#commit();
	}

	markRemindersChecked(at: number) {
		this.remindersCheckedAt = at;
		this.#commit();
	}
}

export const store = new Store();
