import {
	DEFAULT_PRIORITY,
	nextOccurrence,
	type DateKey,
	type Due,
	type Priority,
	type Project,
	type Recurrence,
	type Reminder,
	type Task,
} from 'shared/task.ts';
import { newId } from 'shared/id.ts';
import { loadSnapshot, saveSnapshot, type Snapshot } from './persistence.ts';

export type NewTask = {
	title: string;
	projectId: string | null;
	due: Due | null;
	recurrence: Recurrence | null;
	priority: Priority | null;
	reminders: Reminder[];
};

export type TaskPatch = Partial<
	Pick<Task, 'title' | 'notes' | 'projectId' | 'due' | 'recurrence' | 'priority' | 'reminders'>
>;

export type Completion = { kind: 'done' } | { kind: 'rolled'; next: Due; previous: Pick<Task, 'due' | 'reminders'> };

/** Every mutation is a discrete command that persists synchronously, so it can become a sync log later. */
class Store {
	tasks = $state<Task[]>([]);
	projects = $state<Project[]>([]);
	remindersCheckedAt = $state(0);

	constructor() {
		if (typeof localStorage === 'undefined') return;
		const snapshot = loadSnapshot(Date.now());
		this.tasks = snapshot.tasks;
		this.projects = snapshot.projects;
		this.remindersCheckedAt = snapshot.remindersCheckedAt;
	}

	#commit() {
		const snapshot: Snapshot = $state.snapshot({
			tasks: this.tasks,
			projects: this.projects,
			remindersCheckedAt: this.remindersCheckedAt,
		});
		saveSnapshot(snapshot);
	}

	task(id: string) {
		return this.tasks.find(t => t.id === id);
	}

	project(id: string | null) {
		return id ? this.projects.find(p => p.id === id) : undefined;
	}

	addTask(input: NewTask): Task {
		const task: Task = {
			id: newId(),
			title: input.title,
			notes: '',
			projectId: input.projectId,
			due: input.due,
			recurrence: input.recurrence,
			priority: input.priority ?? DEFAULT_PRIORITY,
			reminders: input.reminders,
			createdAt: Date.now(),
			completedAt: null,
		};
		this.tasks.push(task);
		this.#commit();
		return task;
	}

	updateTask(id: string, patch: TaskPatch) {
		const task = this.task(id);
		if (!task) return;
		Object.assign(task, patch);
		this.#commit();
	}

	/** A recurring task moves to its next occurrence instead of closing. */
	completeTask(id: string, today: DateKey): Completion | undefined {
		const task = this.task(id);
		if (!task) return;
		const next = nextOccurrence(task, today);
		if (!next) {
			task.completedAt = Date.now();
			this.#commit();
			return { kind: 'done' };
		}
		const previous = $state.snapshot({ due: task.due, reminders: task.reminders });
		Object.assign(task, next);
		this.#commit();
		return { kind: 'rolled', next: next.due, previous };
	}

	reopenTask(id: string) {
		const task = this.task(id);
		if (!task) return;
		task.completedAt = null;
		this.#commit();
	}

	deleteTask(id: string) {
		this.tasks = this.tasks.filter(t => t.id !== id);
		this.#commit();
	}

	restoreTask(task: Task) {
		if (this.task(task.id)) return;
		this.tasks.push(task);
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

	markRemindersChecked(at: number) {
		this.remindersCheckedAt = at;
		this.#commit();
	}
}

export const store = new Store();
