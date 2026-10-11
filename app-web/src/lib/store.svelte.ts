import type { DateKey, Label, Project, Task } from 'shared/task.ts';
import { groupChildren, progressOf } from 'shared/subtasks.ts';
import { newId } from 'shared/id.ts';
import type { SyncSection } from 'shared/snapshot.ts';
import * as rules from 'shared/store.ts';
import { applyResponse, commit, startSync, type ClientSync } from 'shared/sync/apply.ts';
import { formatHlc, parseHlc } from 'shared/sync/hlc.ts';
import type { Snapshot as SyncedData, SyncRequest, SyncResponse } from 'shared/sync/protocol.ts';
import { mergeBackup, type ImportSummary, type TodoistBackup } from 'shared/todoist.ts';
import { loadSnapshot, saveSnapshot } from './persistence.ts';

export type { Completion, CompletionState, NewTask, TaskPatch } from 'shared/store.ts';

/**
 * Every mutation is a discrete command from `shared/store.ts` that persists synchronously. The rules return new
 * arrays and objects for what they change, so the arrays are raw state that each command replaces. While the device
 * is paired, each command also diffs the data before and after it into the outbox. An unpaired device keeps none.
 */
class Store {
	tasks = $state.raw<Task[]>([]);
	projects = $state.raw<Project[]>([]);
	labels = $state.raw<Label[]>([]);
	remindersCheckedAt = $state(0);
	#sync = $state.raw<SyncSection | undefined>();
	#onCommit: (() => void) | undefined;
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

	/** The settings record holds only the zone this device last wrote, so a commit never rewrites another's. */
	#synced(sync: SyncSection): SyncedData {
		return { ...this.#data, settings: { timeZone: sync.timeZone } };
	}

	#apply(data: rules.StoreData) {
		const before = this.#sync && this.#synced(this.#sync);
		this.tasks = data.tasks;
		this.projects = data.projects;
		this.labels = data.labels;
		if (this.#sync && before) this.#record(this.#sync, before, this.#synced(this.#sync));
		this.#commit();
	}

	#record(sync: SyncSection, before: SyncedData, after: SyncedData) {
		const next = commit(clientSync(sync), before, after, Date.now());
		if (next.outbox.length === sync.outbox.length) return;
		this.#sync = { ...sectionOf(next, sync.deviceId), timeZone: after.settings.timeZone ?? sync.timeZone };
		this.#onCommit?.();
	}

	#commit() {
		saveSnapshot({ ...this.#data, remindersCheckedAt: this.remindersCheckedAt, sync: this.#sync });
	}

	get paired() {
		return this.#sync !== undefined;
	}

	/** Ops waiting for the server to acknowledge them. */
	get pending() {
		return this.#sync?.outbox.length ?? 0;
	}

	/** Calls `listener` after each command that added ops to the outbox. */
	onCommit(listener: () => void) {
		this.#onCommit = listener;
		return () => (this.#onCommit = undefined);
	}

	/** Starts syncing with the whole local snapshot as the first upload, so this device's data joins the account's. */
	pair(deviceId: string, timeZone: string) {
		const data = { ...this.#data, settings: { timeZone } };
		this.#sync = { ...sectionOf(startSync(data, deviceId, Date.now()), deviceId), timeZone };
		this.#commit();
	}

	/** Stops syncing and drops the outbox. The local data stays as it is. */
	unpair() {
		this.#sync = undefined;
		this.#commit();
	}

	/** Writes the synced time zone only when this device's own zone changed since it last wrote it. */
	noteTimeZone(timeZone: string) {
		if (!this.#sync || this.#sync.timeZone === timeZone) return;
		this.#record(this.#sync, this.#synced(this.#sync), { ...this.#data, settings: { timeZone } });
		this.#commit();
	}

	syncRequest(): SyncRequest | undefined {
		return this.#sync && { cursor: this.#sync.cursor, ops: this.#sync.outbox };
	}

	/** Drops the acknowledged ops, applies the server's changes, and replays the rest of the outbox on top. */
	takeResponse(response: SyncResponse) {
		if (!this.#sync) return;
		const { snapshot, sync } = applyResponse(this.#synced(this.#sync), clientSync(this.#sync), response);
		this.tasks = snapshot.tasks;
		this.projects = snapshot.projects;
		this.labels = snapshot.labels;
		this.#sync = { ...sectionOf(sync, this.#sync.deviceId), timeZone: this.#sync.timeZone };
		this.#commit();
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

const clientSync = ({ cursor, outbox, clock }: SyncSection): ClientSync => ({ cursor, outbox, clock: parseHlc(clock) });

const sectionOf = ({ cursor, outbox, clock }: ClientSync, deviceId: string): Omit<SyncSection, 'timeZone'> => ({
	deviceId,
	cursor,
	outbox,
	clock: formatHlc(clock),
});

export const store = new Store();
