import type { DateKey, Label, Project, Task } from 'shared/task.ts';
import { groupChildren, progressOf } from 'shared/subtasks.ts';
import { newId } from 'shared/id.ts';
import type { SyncSection } from 'shared/snapshot.ts';
import * as rules from 'shared/store.ts';
import { mergeBackup, type ImportSummary, type TodoistBackup } from 'shared/todoist.ts';
import { loadSnapshot, saveSnapshot } from './persistence.ts';

export type { Completion, CompletionState, NewTask, TaskPatch } from 'shared/store.ts';

/**
 * Every mutation is a discrete command from `shared/store.ts` that persists synchronously. The rules return new
 * arrays and objects for what they change, so the arrays are raw state that each command replaces.
 */
class Store {
	tasks = $state.raw<Task[]>([]);
	projects = $state.raw<Project[]>([]);
	labels = $state.raw<Label[]>([]);
	remindersCheckedAt = $state(0);
	#sync: SyncSection | undefined;
	#children = $derived(groupChildren(this.tasks));

	constructor() {
		if (typeof localStorage === 'undefined') return;
		const snapshot = loadSnapshot(Date.now());
		this.tasks = snapshot.tasks;
		this.projects = snapshot.projects;
		this.labels = snapshot.labels;
		this.remindersCheckedAt = snapshot.remindersCheckedAt;
		this.#sync = snapshot.sync;
	}

	get #data(): rules.StoreData {
		return { tasks: this.tasks, projects: this.projects, labels: this.labels };
	}

	#apply(data: rules.StoreData) {
		this.tasks = data.tasks;
		this.projects = data.projects;
		this.labels = data.labels;
		this.#commit();
	}

	#commit() {
		saveSnapshot({ ...this.#data, remindersCheckedAt: this.remindersCheckedAt, sync: this.#sync });
	}

	#creation = (): rules.Creation => ({ id: newId(), now: Date.now() });

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

	addTask(input: rules.NewTask, parentId: string | null = null): Task {
		const { data, task } = rules.addTask(this.#data, input, parentId, this.#creation());
		this.#apply(data);
		return task;
	}

	updateTask(id: string, patch: rules.TaskPatch) {
		this.#apply(rules.updateTask(this.#data, id, patch));
	}

	completeTask(id: string, today: DateKey): rules.Completion | undefined {
		const result = rules.completeTask(this.#data, id, today, Date.now());
		if (!result) return;
		this.#apply(result.data);
		return result.completion;
	}

	reopenTask(id: string) {
		this.#apply(rules.reopenTask(this.#data, id));
	}

	restoreCompletion(previous: readonly rules.CompletionState[]) {
		this.#apply(rules.restoreCompletion(this.#data, previous));
	}

	moveSubtask(id: string, index: number) {
		this.#apply(rules.moveSubtask(this.#data, id, index));
	}

	/** Deletes the task with every subtask under it, and returns them for undo. */
	deleteTask(id: string): Task[] {
		const { data, removed } = rules.deleteTask(this.#data, id);
		this.#apply(data);
		return removed;
	}

	undeleteTasks(removed: readonly Task[]) {
		this.#apply(rules.undeleteTasks(this.#data, removed));
	}

	addProject(name: string): Project {
		const { data, project } = rules.addProject(this.#data, name, this.#creation());
		this.#apply(data);
		return project;
	}

	renameProject(id: string, name: string) {
		this.#apply(rules.renameProject(this.#data, id, name));
	}

	deleteProject(id: string) {
		this.#apply(rules.deleteProject(this.#data, id));
	}

	addLabel(name: string): Label {
		const { data, label } = rules.addLabel(this.#data, name, this.#creation());
		this.#apply(data);
		return label;
	}

	renameLabel(id: string, name: string) {
		this.#apply(rules.renameLabel(this.#data, id, name));
	}

	deleteLabel(id: string) {
		this.#apply(rules.deleteLabel(this.#data, id));
	}

	/** One command and one write for the whole backup, however many tasks it holds. */
	importBackup(backup: TodoistBackup): ImportSummary {
		const { state, summary } = mergeBackup(this.#data, backup, { newId, now: Date.now() });
		this.#apply({ ...state, tasks: rules.sortTasks(state.tasks) });
		return summary;
	}

	markRemindersChecked(at: number) {
		this.remindersCheckedAt = at;
		this.#commit();
	}
}

export const store = new Store();
