import type { DictationChoice } from 'shared/dictation.ts';
import { DEFAULT_QUICK_ADD_BUTTONS, type QuickAddButton } from 'shared/quick-add-buttons.ts';
import type { DateKey, Label, Project, Section, Task } from 'shared/task.ts';
import type { Comment } from 'shared/sync/protocol.ts';
import { groupChildren, progressOf } from 'shared/subtasks.ts';
import { newId } from 'shared/id.ts';
import type { Person, Space } from 'shared/sharing.ts';
import type { SpaceSection, SyncSection } from 'shared/snapshot.ts';
import * as comments from 'shared/comments.ts';
import * as rules from 'shared/store.ts';
import { applyResponse, commit, rejectionNotice, startSync, type ClientSync } from 'shared/sync/apply.ts';
import { formatHlc, parseHlc } from 'shared/sync/hlc.ts';
import {
	DEFAULT_SETTINGS,
	type Settings,
	type Snapshot as SyncedData,
	type SyncRequest,
	type SyncResponse,
} from 'shared/sync/protocol.ts';
import { mergeBackup, type ImportSummary, type TodoistBackup } from 'shared/todoist.ts';
import { clearLocalImages } from './images/local.ts';
import { loadSnapshot, saveSnapshot, STORAGE_KEY } from './persistence.ts';
import { creationHome, emptySection, fitToSpace, homes, merged, sectionStore, type Home } from './spaces.ts';

export type { Completion, CompletionState, NewTask, TaskPatch } from 'shared/store.ts';

const empty = (): rules.StoreData => ({ tasks: [], projects: [], sections: [], labels: [], comments: [], reads: [] });

/** A shared section's data has no settings of its own, so both sides of its diff carry the same placeholder. */
const sectionData = (data: rules.StoreData): SyncedData => ({ ...data, settings: DEFAULT_SETTINGS });

const storeData = ({ tasks, projects, sections, labels, comments, reads }: rules.StoreData): rules.StoreData => ({
	tasks,
	projects,
	sections,
	labels,
	comments,
	reads,
});

/**
 * Every mutation is a discrete command from `shared/store.ts` that persists synchronously. The rules return new
 * arrays and objects for what they change, so the arrays are raw state that each command replaces. Sync is always
 * on: each command diffs into the outbox, which leaves on its own.
 *
 * `own` is the signed-in user's space and `spaces` the sections shared with them. `tasks`, `projects`, `sections`,
 * and `labels` are the merged view. Each command finds the space that holds its target and runs its rule on that
 * space's data only, so personal views read `own` and nothing ever crosses spaces.
 */
class Store {
	own = $state.raw<rules.StoreData>(empty());
	remindersCheckedAt = $state(0);
	spaces = $state.raw<Record<string, SpaceSection>>({});
	people = $state.raw<Person[]>([]);
	#sync = $state.raw<SyncSection | undefined>();
	#onCommit: (() => void) | undefined;
	#view = $derived(merged(this.own, this.spaces));
	#homes = $derived(homes(this.spaces));
	#children = $derived(groupChildren(this.#view.tasks));
	/** Where deleted tasks lived, so undo puts them back into the same space. */
	#deletedFrom = new Map<string, Home>();

	get tasks(): Task[] {
		return this.#view.tasks;
	}

	get projects(): Project[] {
		return this.#view.projects;
	}

	get labels(): Label[] {
		return this.#view.labels;
	}

	get sections(): Section[] {
		return this.#view.sections;
	}

	/** Every comment this user can see, own and shared. */
	get comments(): Comment[] {
		return this.#view.comments;
	}

	constructor() {
		if (typeof localStorage === 'undefined') return;
		this.#load();
		if (!this.#sync) {
			this.#sync = this.#fresh(crypto.randomUUID());
			this.#commit();
		}
		// Every tab saves the whole document, so one left open in the background would save its old copy over
		// what this tab synced, and the next launch would start from it.
		window.addEventListener('storage', event => {
			if (event.key !== STORAGE_KEY) return;
			this.#load();
			// The writing tab may be offline, so this one uploads what it left in the outbox.
			if (this.#sync?.outbox.length || this.#sync?.reset || Object.values(this.spaces).some(s => s.outbox.length))
				this.#onCommit?.();
		});
	}

	#load() {
		const snapshot = loadSnapshot(Date.now());
		this.own = storeData(snapshot);
		this.remindersCheckedAt = snapshot.remindersCheckedAt;
		this.spaces = snapshot.spaces;
		this.people = snapshot.people;
		this.#sync = snapshot.sync;
	}

	/** A first launch seeds: its first snapshot queues whatever stored data the server lacks, so an existing list joins. */
	#fresh(deviceId: string): SyncSection {
		const settings = { ...DEFAULT_SETTINGS, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
		return sectionOf(startSync(settings, deviceId, Date.now()), {
			...settings,
			deviceId,
			reset: false,
		});
	}

	get #data(): rules.StoreData {
		return this.own;
	}

	/**
	 * The zone on the settings record is the one this device last wrote, so a commit never rewrites another's.
	 * The other settings are the choices last applied here, including ones that arrived from another device.
	 */
	#synced(sync: SyncSection): SyncedData {
		return { ...this.#data, settings: settingsOf(sync) };
	}

	#apply(data: rules.StoreData) {
		const before = this.#sync && this.#synced(this.#sync);
		this.own = storeData(data);
		if (this.#sync && before) this.#record(this.#sync, before, this.#synced(this.#sync));
		this.#commit();
	}

	#record(sync: SyncSection, before: SyncedData, after: SyncedData) {
		const current = clientSync(sync);
		const next = commit(current, before, after, Date.now());
		if (next === current) return;
		this.#sync = sectionOf(next, {
			...sync,
			...after.settings,
			timeZone: after.settings.timeZone ?? sync.timeZone,
		});
		this.#onCommit?.();
	}

	#commit() {
		saveSnapshot({
			...this.#data,
			remindersCheckedAt: this.remindersCheckedAt,
			sync: this.#sync,
			spaces: this.spaces,
			people: this.people,
		});
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
		this.own = empty();
		this.spaces = {};
		this.people = [];
		this.#sync = {
			...DEFAULT_SETTINGS,
			deviceId,
			cursor: 0,
			outbox: [],
			clock,
			timeZone,
			epoch: 0,
			reset: false,
			seed: false,
		};
		this.#commit();
		void clearLocalImages().catch(() => undefined);
	}

	/** Empties tasks, projects, sections, and labels here, and asks the next sync to wipe them on the server too. */
	deleteAll() {
		this.own = empty();
		if (this.#sync) this.#sync = { ...this.#sync, cursor: 0, outbox: [], reset: true };
		this.#commit();
		this.#onCommit?.();
	}

	/** The dictation choice last applied here. Native until a document has loaded. */
	get dictation(): DictationChoice {
		return this.#sync?.dictation ?? 'native';
	}

	/** Remembers the choice and queues it for sync. Offline voice still uses native. */
	setDictation(dictation: DictationChoice) {
		this.#setSettings({ dictation });
	}

	/** The quick add buttons pinned to the chip row. The defaults until a document has loaded. */
	get quickAddButtons(): QuickAddButton[] {
		return this.#sync?.quickAddButtons ?? DEFAULT_QUICK_ADD_BUTTONS;
	}

	setQuickAddButtons(quickAddButtons: QuickAddButton[]) {
		this.#setSettings({ quickAddButtons });
	}

	/** Writes the synced time zone only when this device's own zone changed since it last wrote it. */
	noteTimeZone(timeZone: string) {
		this.#setSettings({ timeZone });
	}

	#setSettings(patch: Partial<Settings>) {
		if (!this.#sync) return;
		const before = settingsOf(this.#sync);
		const after = { ...before, ...patch };
		if (JSON.stringify(after) === JSON.stringify(before)) return;
		this.#record(this.#sync, this.#synced(this.#sync), { ...this.#data, settings: after });
		this.#commit();
	}

	syncRequest(): SyncRequest | undefined {
		if (!this.#sync) return;
		return {
			cursor: this.#sync.cursor,
			ops: this.#sync.outbox,
			epoch: this.#sync.epoch,
			scope: '',
			...(this.#sync.reset ? { reset: true } : {}),
		};
	}

	/**
	 * Drops the acknowledged and rejected ops, applies the server's changes, and replays the rest of the outbox on top.
	 * `seeded` is set when the first snapshot queued local data the server lacks, so another round is due, and
	 * `notice` names what the server refused to save.
	 */
	takeResponse(response: SyncResponse): { seeded: boolean; notice: string | null } {
		if (!this.#sync) return { seeded: false, notice: null };
		const before = this.#synced(this.#sync);
		const { snapshot, sync, rejected } = applyResponse(before, clientSync(this.#sync), response, Date.now(), {
			sentReset: this.#sync.reset,
		});
		const seeded = this.#sync.seed && !sync.seed && sync.outbox.length > 0;
		this.own = storeData(snapshot);
		const { dictation, quickAddButtons } = snapshot.settings;
		this.#sync = sectionOf(sync, { ...this.#sync, reset: false, dictation, quickAddButtons });
		this.#commit();
		return { seeded, notice: rejectionNotice(before, rejected) };
	}

	#creation = (): rules.Creation => ({ id: newId(), now: Date.now() });

	homeOf = (id: string): Home => this.#homes.get(id) ?? null;

	/** The data of one space, whose projects and labels are the only ones its tasks may use. */
	dataOf(home: Home): rules.StoreData {
		const section = home === null ? undefined : this.spaces[home];
		return home === null ? this.own : section ? sectionStore(section) : empty();
	}

	/** False for a shared task the server marked read only, and for one in a space this user no longer reaches. */
	canEdit(id: string): boolean {
		const home = this.homeOf(id);
		if (home === null) return true;
		const section = this.spaces[home];
		return !!section && !section.readOnly.includes(id);
	}

	/**
	 * Runs one rule on one space. A shared section's ops go into its own outbox, stamped by the one device clock,
	 * so a shared space never sees the user's own data and the clock stays ahead of every space's edits.
	 */
	#run(home: Home, rule: (data: rules.StoreData) => rules.StoreData) {
		if (home === null) return this.#apply(rule(this.own));
		const section = this.spaces[home];
		if (!section || !this.#sync) return;
		const before = sectionStore(section);
		const after = rule(before);
		const current = spaceSync(section, this.#sync);
		const next = commit(current, sectionData(before), sectionData({ ...after, reads: [] }), Date.now());
		if (next === current) return;
		const { tasks, projects, sections, labels, comments } = after;
		this.spaces = {
			...this.spaces,
			[home]: { ...section, tasks, projects, sections, labels, comments, outbox: next.outbox },
		};
		this.#sync = { ...this.#sync, clock: formatHlc(next.clock) };
		this.#commit();
		this.#onCommit?.();
	}

	#onTask(id: string, rule: (data: rules.StoreData) => rules.StoreData) {
		if (this.canEdit(id)) this.#run(this.homeOf(id), rule);
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

	section(id: string | null) {
		return id ? this.sections.find(s => s.id === id) : undefined;
	}

	/** A project's sections in their order. */
	sectionsOf(projectId: string): Section[] {
		return rules.sectionsOf(this.sections, projectId);
	}

	labelsOf(task: Pick<Task, 'labelIds'>) {
		return task.labelIds.map(id => this.label(id)).filter(label => label !== undefined);
	}

	/** Lands in the parent's space, else the project's, else a shared label's, else the user's own. */
	addTask(input: rules.NewTask, parentId: string | null = null): Task | undefined {
		if (parentId && !this.canEdit(parentId)) return;
		const home = creationHome(this.homeOf, input, parentId);
		let task: Task | undefined;
		this.#run(home, data => {
			const result = rules.addTask(data, home === null ? input : fitToSpace(data, input), parentId, this.#creation());
			task = result.task;
			return result.data;
		});
		return task;
	}

	updateTask(id: string, patch: rules.TaskPatch) {
		this.#onTask(id, data => rules.updateTask(data, id, patch));
	}

	completeTask(id: string, today: DateKey): rules.Completion | undefined {
		let completion: rules.Completion | undefined;
		this.#onTask(id, data => {
			const result = rules.completeTask(data, id, today, Date.now());
			completion = result?.completion;
			return result?.data ?? data;
		});
		return completion;
	}

	reopenTask(id: string) {
		this.#onTask(id, data => rules.reopenTask(data, id));
	}

	restoreCompletion(previous: readonly rules.CompletionState[]) {
		const first = previous[0];
		if (first) this.#onTask(first.id, data => rules.restoreCompletion(data, previous));
	}

	moveSubtask(id: string, index: number) {
		this.#onTask(id, data => rules.moveSubtask(data, id, index));
	}

	/**
	 * Turns the task's subtasks into tasks of their own, and returns them as they were for undo. Only in the user's own
	 * space: moving a subtask up can carry it out of what a share grants, and the server would refuse the edit.
	 */
	explodeSubtasks(id: string, method: rules.ExplodeMethod): rules.ExplodedState[] {
		let previous: rules.ExplodedState[] = [];
		if (this.homeOf(id) !== null) return previous;
		this.#onTask(id, data => {
			const result = rules.explodeSubtasks(data, id, method);
			previous = result.previous;
			return result.data;
		});
		return previous;
	}

	restoreExploded(previous: readonly rules.ExplodedState[]) {
		const first = previous[0];
		if (first) this.#onTask(first.id, data => rules.restoreExploded(data, previous));
	}

	/** Deletes the task with every subtask under it, and returns them for undo. */
	deleteTask(id: string): Task[] {
		const home = this.homeOf(id);
		let removed: Task[] = [];
		this.#onTask(id, data => {
			const result = rules.deleteTask(data, id);
			removed = result.removed;
			return result.data;
		});
		for (const task of removed) this.#deletedFrom.set(task.id, home);
		return removed;
	}

	undeleteTasks(removed: readonly Task[]) {
		const first = removed[0];
		if (first) this.#run(this.#deletedFrom.get(first.id) ?? null, data => rules.undeleteTasks(data, removed));
	}

	/** Projects and labels are always made in the user's own space. Shared ones are never renamed or deleted here. */
	addProject(name: string): Project {
		const { data, project } = rules.addProject(this.own, name, this.#creation());
		this.#apply(data);
		return project;
	}

	renameProject(id: string, name: string) {
		if (this.homeOf(id) === null) this.#apply(rules.renameProject(this.own, id, name));
	}

	deleteProject(id: string) {
		if (this.homeOf(id) === null) this.#apply(rules.deleteProject(this.own, id));
	}

	/** Sections, like projects, are only ever written in the user's own space. */
	addSection(projectId: string, name: string): Section | undefined {
		if (this.homeOf(projectId) !== null) return;
		const { data, section } = rules.addSection(this.own, projectId, name, this.#creation());
		this.#apply(data);
		return section;
	}

	renameSection(id: string, name: string) {
		if (this.homeOf(id) === null) this.#apply(rules.renameSection(this.own, id, name));
	}

	moveSection(id: string, index: number) {
		if (this.homeOf(id) === null) this.#apply(rules.moveSection(this.own, id, index));
	}

	deleteSection(id: string) {
		if (this.homeOf(id) === null) this.#apply(rules.deleteSection(this.own, id));
	}

	addLabel(name: string): Label {
		const { data, label } = rules.addLabel(this.own, name, this.#creation());
		this.#apply(data);
		return label;
	}

	renameLabel(id: string, name: string) {
		if (this.homeOf(id) === null) this.#apply(rules.renameLabel(this.own, id, name));
	}

	deleteLabel(id: string) {
		if (this.homeOf(id) === null) this.#apply(rules.deleteLabel(this.own, id));
	}

	/** One command and one write for the whole backup, however many tasks it holds. */
	importBackup(backup: TodoistBackup): ImportSummary {
		const { state, summary } = mergeBackup(this.own, backup, { newId, now: Date.now() });
		this.#apply({ ...state, tasks: rules.sortTasks(state.tasks) });
		return summary;
	}

	/** Adds a section for each new shared space and drops the ones no longer shared. */
	setSpaces(list: readonly Space[]) {
		this.spaces = Object.fromEntries(
			list.map(({ id, owner }) => [id, { ...(this.spaces[id] ?? emptySection(owner)), owner }] as const),
		);
		this.rememberPeople(list.map(space => space.owner));
		this.#commit();
	}

	dropSpace(owner: string) {
		if (!this.spaces[owner]) return;
		const { [owner]: _, ...rest } = this.spaces;
		this.spaces = rest;
		this.#commit();
	}

	/**
	 * Sending ops always asks for a fresh snapshot (`scope: ''`): an op the server refuses leaves what this user may
	 * see unchanged, so the scope hash alone would keep the refused edit showing here.
	 */
	spaceRequest(owner: string): SyncRequest | undefined {
		const section = this.spaces[owner];
		if (!section) return;
		return {
			cursor: section.cursor,
			ops: section.outbox,
			epoch: section.epoch,
			scope: section.outbox.length ? '' : section.scope,
		};
	}

	/** Applies a shared space's answer like `takeResponse`, and returns the notice for what the server refused. */
	takeSpaceResponse(owner: string, response: SyncResponse): string | null {
		const section = this.spaces[owner];
		if (!section || !this.#sync) return null;
		const before = sectionData(sectionStore(section));
		const { snapshot, sync, rejected } = applyResponse(before, spaceSync(section, this.#sync), response, Date.now());
		this.spaces = {
			...this.spaces,
			[owner]: {
				...section,
				tasks: snapshot.tasks,
				projects: snapshot.projects,
				sections: snapshot.sections,
				labels: snapshot.labels,
				comments: snapshot.comments,
				cursor: sync.cursor,
				outbox: sync.outbox,
				epoch: sync.epoch,
				scope: response.scope ?? section.scope,
				readOnly: 'snapshot' in response ? (response.readOnly ?? []) : section.readOnly,
				targets: 'snapshot' in response ? (response.targets ?? []) : section.targets,
			},
		};
		this.#sync = { ...this.#sync, clock: formatHlc(sync.clock) };
		this.#commit();
		return rejectionNotice(before, rejected);
	}

	/** Comments are written in the task's space, so only someone who may edit the task can comment on it. */
	addComment(taskId: string, body: string, me: string): Comment | undefined {
		let comment: Comment | null = null;
		this.#onTask(taskId, data => {
			const result = comments.addComment(data, taskId, body, me, this.#creation());
			comment = result.comment;
			return result.data;
		});
		return comment ?? undefined;
	}

	editComment(id: string, body: string, me: string) {
		const comment = this.comments.find(c => c.id === id);
		if (comment) this.#onTask(comment.taskId, data => comments.editComment(data, id, body, me, Date.now()));
	}

	/** Deletes `me`'s own comment and returns it for undo. */
	deleteComment(id: string, me: string): Comment | undefined {
		const comment = this.comments.find(c => c.id === id);
		if (comment) this.#onTask(comment.taskId, data => comments.deleteComment(data, id, me));
		return comment;
	}

	undeleteComment(comment: Comment) {
		this.#onTask(comment.taskId, data =>
			data.comments.some(c => c.id === comment.id) ? data : { ...data, comments: [...data.comments, comment] },
		);
	}

	/** The marker goes into the user's own space, whichever space holds the task. */
	markCommentsRead(taskId: string, me: string) {
		const next = comments.markRead(this.own, taskId, this.comments, me, Date.now());
		if (next !== this.own) this.#apply(next);
	}

	person(id: string | null): Person | undefined {
		return id ? this.people.find(p => p.id === id) : undefined;
	}

	/** Keeps the latest name and kind of everyone seen, so authorship shows offline. */
	rememberPeople(people: readonly Person[]) {
		const byId = new Map(this.people.map(p => [p.id, p]));
		let changed = false;
		for (const person of people) {
			const known = byId.get(person.id);
			if (known && known.name === person.name && known.kind === person.kind && known.ownerId === person.ownerId)
				continue;
			byId.set(person.id, person);
			changed = true;
		}
		if (!changed) return;
		this.people = [...byId.values()];
		this.#commit();
	}

	markRemindersChecked(at: number) {
		this.remindersCheckedAt = at;
		this.#commit();
	}
}

const clientSync = ({ cursor, outbox, clock, epoch, seed }: SyncSection): ClientSync => ({
	cursor,
	outbox,
	clock: parseHlc(clock),
	epoch,
	seed,
});

/** A shared space only ever holds what its owner synced, so it has nothing to seed. */
const spaceSync = ({ cursor, outbox, epoch }: SpaceSection, sync: SyncSection): ClientSync => ({
	cursor,
	outbox,
	clock: parseHlc(sync.clock),
	epoch,
	seed: false,
});

const settingsOf = ({ timeZone, dictation, quickAddButtons }: SyncSection): Settings => ({
	timeZone,
	dictation,
	quickAddButtons,
});

const sectionOf = (
	{ cursor, outbox, clock, epoch, seed }: ClientSync,
	previous: Pick<SyncSection, 'deviceId' | 'timeZone' | 'dictation' | 'quickAddButtons' | 'reset'>,
): SyncSection => ({
	deviceId: previous.deviceId,
	cursor,
	outbox,
	clock: formatHlc(clock),
	timeZone: previous.timeZone,
	dictation: previous.dictation,
	quickAddButtons: previous.quickAddButtons,
	epoch,
	reset: previous.reset,
	seed,
});

export const store = new Store();
