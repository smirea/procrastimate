import type { DictationChoice } from 'shared/dictation.ts';
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
 * arrays and objects for what they change, so the arrays are raw state that each command replaces. Sync is always
 * on: each command diffs into the outbox, which leaves on its own.
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
		this.#sync = snapshot.sync ?? this.#fresh(crypto.randomUUID());
		if (!snapshot.sync) this.#commit();
	}

	/** A first launch uploads whatever is already stored, so an existing list joins the account. */
	#fresh(deviceId: string): SyncSection {
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const dictation: DictationChoice = 'native';
		return sectionOf(startSync({ ...this.#data, settings: { timeZone, dictation } }, deviceId, Date.now()), {
			deviceId,
			timeZone,
			dictation,
			reset: false,
		});
	}

	get #data(): rules.StoreData {
		return { tasks: this.tasks, projects: this.projects, labels: this.labels };
	}

	/**
	 * The zone on the settings record is the one this device last wrote, so a commit never rewrites another's.
	 * Dictation is the choice last applied here, including one that arrived from another device.
	 */
	#synced(sync: SyncSection): SyncedData {
		return { ...this.#data, settings: { timeZone: sync.timeZone, dictation: sync.dictation } };
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
		this.#sync = sectionOf(next, {
			...sync,
			timeZone: after.settings.timeZone ?? sync.timeZone,
			dictation: after.settings.dictation,
		});
		this.#onCommit?.();
	}

	#commit() {
		saveSnapshot({ ...this.#data, remindersCheckedAt: this.remindersCheckedAt, sync: this.#sync });
	}

	deviceId() {
		return this.#sync?.deviceId;
	}

	get ready() {
		return this.#sync !== undefined;
	}

	get pending() {
		return this.#sync?.outbox.length ?? 0;
	}

	/** Calls `listener` after each command that added ops to the outbox. */
	onCommit(listener: () => void) {
		this.#onCommit = listener;
		return () => (this.#onCommit = undefined);
	}

	/**
	 * Keeps the section the constructor started, or adopts the id the server stored when the one we sent was taken.
	 * A new id does not re-upload: the outbox and cursor stay.
	 */
	adoptDevice(deviceId: string) {
		if (!this.#sync) this.#sync = this.#fresh(deviceId);
		else if (this.#sync.deviceId !== deviceId) this.#sync = { ...this.#sync, deviceId };
		this.#commit();
	}

	/**
	 * Drops this document for a different signed-in user. The device id stays. Cursor 0 and an empty outbox make the
	 * next sync a snapshot pull, so the previous user's tasks are not uploaded.
	 */
	switchUser() {
		const deviceId = this.#sync?.deviceId ?? crypto.randomUUID();
		const timeZone = this.#sync?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
		const clock = this.#sync?.clock ?? `0:0:${deviceId}`;
		this.tasks = [];
		this.projects = [];
		this.labels = [];
		this.#sync = { deviceId, cursor: 0, outbox: [], clock, timeZone, dictation: 'native', epoch: 0, reset: false };
		this.#commit();
	}

	/** Empties tasks, projects, and labels here, and asks the next sync to wipe them on the server too. */
	deleteAll() {
		this.tasks = [];
		this.projects = [];
		this.labels = [];
		if (this.#sync) this.#sync = { ...this.#sync, cursor: 0, outbox: [], reset: true };
		this.#commit();
		this.#onCommit?.();
	}

	/** The dictation choice last applied here. Native until a document has loaded. */
	get dictation(): DictationChoice {
		return this.#sync?.dictation ?? 'native';
	}

	/** Remembers the choice and queues it for sync. Offline voice still uses native. */
	setDictation(choice: DictationChoice) {
		if (!this.#sync || this.#sync.dictation === choice) return;
		this.#record(this.#sync, this.#synced(this.#sync), {
			...this.#data,
			settings: { timeZone: this.#sync.timeZone, dictation: choice },
		});
		this.#commit();
	}

	/** Writes the synced time zone only when this device's own zone changed since it last wrote it. */
	noteTimeZone(timeZone: string) {
		if (!this.#sync || this.#sync.timeZone === timeZone) return;
		this.#record(this.#sync, this.#synced(this.#sync), {
			...this.#data,
			settings: { timeZone, dictation: this.#sync.dictation },
		});
		this.#commit();
	}

	syncRequest(): SyncRequest | undefined {
		if (!this.#sync) return;
		return {
			cursor: this.#sync.cursor,
			ops: this.#sync.outbox,
			epoch: this.#sync.epoch,
			...(this.#sync.reset ? { reset: true } : {}),
		};
	}

	/** Drops the acknowledged ops, applies the server's changes, and replays the rest of the outbox on top. */
	takeResponse(response: SyncResponse) {
		if (!this.#sync) return;
		const { snapshot, sync } = applyResponse(this.#synced(this.#sync), clientSync(this.#sync), response, {
			sentReset: this.#sync.reset,
		});
		this.tasks = snapshot.tasks;
		this.projects = snapshot.projects;
		this.labels = snapshot.labels;
		this.#sync = sectionOf(sync, { ...this.#sync, reset: false, dictation: snapshot.settings.dictation });
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

const clientSync = ({ cursor, outbox, clock, epoch }: SyncSection): ClientSync => ({
	cursor,
	outbox,
	clock: parseHlc(clock),
	epoch,
});

const sectionOf = (
	{ cursor, outbox, clock, epoch }: ClientSync,
	previous: Pick<SyncSection, 'deviceId' | 'timeZone' | 'dictation' | 'reset'>,
): SyncSection => ({
	deviceId: previous.deviceId,
	cursor,
	outbox,
	clock: formatHlc(clock),
	timeZone: previous.timeZone,
	dictation: previous.dictation,
	epoch,
	reset: previous.reset,
});

export const store = new Store();
