import type { DictationChoice } from 'shared/dictation.ts';
import type { LabelColor } from 'shared/label-colors.ts';
import type { QuickAddButton } from 'shared/quick-add-buttons.ts';
import type { DateKey, Label, Project, Section, Task } from 'shared/task.ts';
import type { SavedPlace } from 'shared/values.ts';
import { DEFAULT_SETTINGS, type Comment, type Settings, type Snapshot } from 'shared/model.ts';
import { rowWrites, sameValue } from 'shared/rows.ts';
import { groupChildren, progressOf } from 'shared/subtasks.ts';
import { newId } from 'shared/id.ts';
import type { Person } from 'shared/sharing.ts';
import * as comments from 'shared/comments.ts';
import * as rules from 'shared/store.ts';
import { mergeBackup, type ImportSummary, type TodoistBackup } from 'shared/todoist.ts';
import { CHANGE_LOG, powerSync, readSince, storedOwner, storeOwner, trimChanges, writeRows } from './database.ts';
import {
	forgetDatabaseId,
	forgetLegacyDocument,
	onOwnerChange,
	loadPeople,
	loadRemindersCheckedAt,
	loadUnwritten,
	saveOwner,
	savePeople,
	saveRemindersCheckedAt,
	saveUnwritten,
	type Unwritten,
} from './device.ts';
import { clearLocalImages } from './images/local.ts';
import { LocalRows } from 'shared/local-rows.ts';
import { reportError } from './sentry.ts';
import { emptyData, homes, merged, sharedSpace, type SharedSpace, type Spaces } from './spaces.ts';
import { creationHome, fitPatch, fitToSpace, type Home, type Homes } from 'shared/space-routing.ts';

export type { Completion, CompletionState, NewTask, TaskPatch } from 'shared/store.ts';

const storeData = ({ tasks, projects, sections, labels, comments, reads }: rules.StoreData): rules.StoreData => ({
	tasks,
	projects,
	sections,
	labels,
	comments,
	reads,
});

/**
 * Clears the previous account's rows, upload queue, and local images, and tries again until it works: the database
 * never belongs to the signed-in user while it may hold someone else's rows.
 */
async function clearUntilDone() {
	for (let wait = 1000; ; wait = Math.min(wait * 2, 30_000)) {
		try {
			await Promise.all([powerSync.disconnectAndClear(), clearLocalImages()]);
			return;
		} catch (error) {
			reportError(error);
			await new Promise(resolve => setTimeout(resolve, wait));
		}
	}
}

/**
 * The rules in `shared/store.ts` return new arrays and objects for what they change, so the arrays are raw state that
 * each command replaces at once. When the database changes, from this tab, another tab, or the server, the store reads
 * back only the rows that changed. Each command runs its rule on one space's data only, so nothing ever crosses spaces.
 */
class Store {
	own = $state.raw<rules.StoreData>(emptyData());
	settings = $state.raw<Settings>(DEFAULT_SETTINGS);
	spaces = $state.raw<Spaces>({});
	people = $state.raw<Person[]>([]);
	remindersCheckedAt = $state(0);
	loaded = $state(false);
	/**
	 * True when the first read of the local database failed. The app says so rather than show an empty list whose
	 * edits would never be written.
	 */
	unreadable = $state(false);
	#owner: string | null = null;
	/**
	 * Whether the local database holds the settings row, which the server makes for every user and the first sync
	 * brings. Until then a settings change waits in `#heldSettings`, because only a patch of an existing row may write
	 * settings: a client never makes the row, so it can never write defaults over the user's choices.
	 */
	#hasSettings = false;
	#heldSettings: Partial<Settings> = {};
	/** Commands issued so far. A read that started before the newest one would undo it, so it is discarded. */
	#commands = 0;
	#writing = 0;
	#queue: Promise<void> = Promise.resolve();
	#unwritten: Unwritten[] = [];
	#reading = false;
	#stale = false;
	#rows = new LocalRows('');
	/** The newest change in the database's log that memory reflects; null reads everything next. */
	#cursor: number | null = null;
	/** What the reads cost so far, for the end-to-end specs. */
	readStats = { reloads: 0, rows: 0, ms: 0 };
	#switching: Promise<void> = Promise.resolve();
	/** Until the database belongs to the signed-in user, a read could show another account's rows as theirs. */
	#opening = false;
	#view = $derived(merged(this.own, this.spaces));
	/**
	 * One derived per list, so a command that replaced only the tasks does not rerun everything that reads the
	 * labels, sections, or comments: Svelte tracks the `#view` signal, not its fields.
	 */
	#tasks = $derived(this.#view.tasks);
	#labels = $derived(this.#view.labels);
	#sections = $derived(this.#view.sections);
	#comments = $derived(this.#view.comments);
	#ownProjectRows = $derived(this.own.projects);
	#ownProjects = $derived(rules.projectsInOrder(this.#ownProjectRows));
	#projects = $derived([
		...this.#ownProjects,
		...Object.values(this.spaces).flatMap(s => rules.projectsInOrder(s.data.projects)),
	]);
	#homes = $derived(homes(this.spaces));
	#children = $derived(groupChildren(this.#tasks));
	#taskById = $derived(new Map(this.#tasks.map(t => [t.id, t])));
	#projectById = $derived(new Map(this.#projects.map(p => [p.id, p])));
	#labelById = $derived(new Map(this.#labels.map(l => [l.id, l])));
	#sectionById = $derived(new Map(this.#sections.map(s => [s.id, s])));
	#commentById = $derived(new Map(this.#comments.map(c => [c.id, c])));
	/** Where deleted tasks lived, so undo puts them back into the same space. */
	#deletedFrom = new Map<string, Home>();

	get tasks(): Task[] {
		return this.#tasks;
	}

	get projects(): Project[] {
		return this.#projects;
	}

	get ownProjects(): Project[] {
		return this.#ownProjects;
	}

	get labels(): Label[] {
		return this.#labels;
	}

	get sections(): Section[] {
		return this.#sections;
	}

	get comments(): Comment[] {
		return this.#comments;
	}

	constructor() {
		if (typeof localStorage === 'undefined') return;
		forgetLegacyDocument();
		this.people = loadPeople();
		this.remindersCheckedAt = loadRemindersCheckedAt(Date.now());
		powerSync.onChange({ onChange: () => this.#reload() }, { tables: [CHANGE_LOG], throttleMs: 10 });
		onOwnerChange(() => location.reload());
	}

	/**
	 * Opens the database for `userId`, the moment the session names them. A database that holds another account's rows
	 * is cleared first, with its upload queue and local images, so nothing of that account shows or uploads; it becomes
	 * `userId`'s only once that worked, so a launch that finds it still named after the other account clears it again.
	 * Then the tab's unwritten copy is written and the database read. Resolves once it is safe to connect.
	 */
	open(userId: string): Promise<void> {
		if (this.#owner === userId) return this.#switching;
		if (this.#owner !== null) {
			this.own = emptyData();
			this.settings = DEFAULT_SETTINGS;
			this.spaces = {};
			this.people = [];
			savePeople([]);
			this.loaded = false;
		}
		this.#owner = userId;
		this.#rows = new LocalRows(userId);
		this.#cursor = null;
		this.unreadable = false;
		this.#hasSettings = false;
		this.#heldSettings = {};
		this.#opening = true;
		this.#unwritten = [];
		this.#switching = this.#switching
			.then(() => this.#queue)
			.then(async () => {
				const previous = await storedOwner();
				if (previous !== null && previous !== userId) {
					await clearUntilDone();
					forgetDatabaseId();
				}
				if (this.#owner !== userId) return;
				await storeOwner(userId);
				saveOwner(userId);
				this.#opening = false;
				for (const entry of loadUnwritten(userId)) this.#write(entry);
				this.#reload();
			})
			.catch(error => {
				reportError(error);
				if (this.#owner === userId) this.unreadable = true;
			});
		return this.#switching;
	}

	/** Resolves once every command so far is in the local database, and so in PowerSync's upload queue. */
	written(): Promise<void> {
		return this.#queue;
	}

	#apply(data: rules.StoreData) {
		const before = this.own;
		this.own = storeData(data);
		if (this.#owner)
			this.#persist(this.#owner, { ...before, settings: this.settings }, { ...this.own, settings: this.settings });
	}

	#persist(owner: string, before: Snapshot, after: Snapshot) {
		const writes = rowWrites(before, after);
		if (!writes.length) return;
		this.#commands++;
		this.#write({ owner, writes });
	}

	/**
	 * Writes one command's rows in its turn, keeping a copy in the tab until they are in the database. Each write
	 * converges, so the copy a reload replays is harmless when its rows did land. A write that failed keeps its copy,
	 * which the next launch writes again.
	 */
	#write(entry: Unwritten) {
		const user = this.#owner!;
		if (!this.#unwritten.includes(entry)) this.#unwritten.push(entry);
		saveUnwritten(user, this.#unwritten);
		this.#writing++;
		this.#queue = this.#queue
			.then(() => writeRows(entry.owner, entry.writes))
			.then(
				() => {
					this.#unwritten = this.#unwritten.filter(other => other !== entry);
					if (this.#owner === user) saveUnwritten(user, this.#unwritten);
				},
				error => {
					reportError(error);
					this.#cursor = null;
					this.#stale = true;
				},
			)
			.finally(() => {
				this.#writing--;
				if (this.#stale) this.#reload();
			});
	}

	#reload() {
		if (this.#writing > 0 || this.#reading || this.#opening || !this.#owner) {
			this.#stale = true;
			return;
		}
		this.#stale = false;
		this.#reading = true;
		void this.#read().finally(() => {
			this.#reading = false;
			if (this.#stale) this.#reload();
		});
	}

	async #read() {
		const owner = this.#owner!;
		const rows = this.#rows;
		const commands = this.#commands;
		const started = performance.now();
		let read;
		try {
			read = await readSince(this.#cursor);
		} catch (error) {
			reportError(error);
			if (owner === this.#owner && !this.loaded) this.unreadable = true;
			return;
		}
		if (owner !== this.#owner) return;
		if (commands !== this.#commands) {
			this.#stale = true;
			return;
		}
		this.#cursor = read.cursor;
		const touched = new Set(rows.apply(read.changes));
		if (read.full) touched.add(owner);
		this.#take(touched);
		this.readStats.reloads++;
		this.readStats.rows += Object.values(read.changes).reduce((sum, { rows }) => sum + rows.length, 0);
		this.readStats.ms += performance.now() - started;
		this.unreadable = false;
		// In the same step as `loaded`, so nothing that waits for the store to load can see it before the zone is noted.
		if (!this.loaded) this.noteTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
		this.loaded = true;
		trimChanges(read).catch(reportError);
	}

	/** Builds again only the spaces whose rows changed, and keeps every entity that did not, so nothing else re-renders. */
	#take(touched: ReadonlySet<string>) {
		const me = this.#owner!;
		if (touched.has(me)) this.own = keepSame(this.own, this.#rows.own());
		this.#takeSettings(this.#rows.settings());
		let spaces: Record<string, SharedSpace> | null = null;
		for (const owner of touched) {
			if (owner === me) continue;
			const previous = this.spaces[owner];
			const rows = this.#rows.space(owner);
			const kept = rows ? keepSpace(previous, sharedSpace(owner, rows)) : undefined;
			if (kept === previous) continue;
			spaces ??= { ...this.spaces };
			if (kept) spaces[owner] = kept;
			else delete spaces[owner];
		}
		if (spaces) this.spaces = spaces;
	}

	#takeSettings(stored: Settings | null) {
		this.#hasSettings = stored !== null;
		const next = { ...(stored ?? DEFAULT_SETTINGS), ...this.#heldSettings };
		if (stored && Object.keys(this.#heldSettings).length) {
			this.#heldSettings = {};
			this.#persist(this.#owner!, { ...this.own, settings: stored }, { ...this.own, settings: next });
		}
		if (!sameValue(this.settings, next)) this.settings = next;
	}

	get holdsSettings(): boolean {
		return Object.keys(this.#heldSettings).length > 0;
	}

	/** Whether a command's rows are still on their way into the local database. */
	get writing(): boolean {
		return this.#writing > 0;
	}

	deleteAll() {
		this.#apply(emptyData());
	}

	get dictation(): DictationChoice {
		return this.settings.dictation;
	}

	/** Offline voice still uses native. */
	setDictation(dictation: DictationChoice) {
		this.#setSettings({ dictation });
	}

	get quickAddButtons(): QuickAddButton[] {
		return this.settings.quickAddButtons;
	}

	setQuickAddButtons(quickAddButtons: QuickAddButton[]) {
		this.#setSettings({ quickAddButtons });
	}

	/** The zone push notifications are planned in. */
	noteTimeZone(timeZone: string) {
		this.#setSettings({ timeZone });
	}

	#setSettings(patch: Partial<Settings>) {
		if (!this.#owner) return;
		const before = this.settings;
		const after = { ...before, ...patch };
		if (sameValue(after, before)) return;
		this.settings = after;
		if (this.#hasSettings)
			this.#persist(this.#owner, { ...this.own, settings: before }, { ...this.own, settings: after });
		else this.#heldSettings = { ...this.#heldSettings, ...patch };
	}

	#creation = (): rules.Creation => ({ id: newId(), now: Date.now() });

	/** Every shared entity's owner, which decides the space a command runs in. */
	get homes(): Homes {
		return this.#homes;
	}

	homeOf = (id: string): Home => this.#homes[id] ?? null;

	/** The data of one space, whose projects and labels are the only ones its tasks may use. */
	dataOf(home: Home): rules.StoreData {
		return home === null ? this.own : (this.spaces[home]?.data ?? emptyData());
	}

	/** False for a shared task its owner shared read only, and for one in a space this user no longer reaches. */
	canEdit(id: string): boolean {
		const home = this.homeOf(id);
		if (home === null) return true;
		const space = this.spaces[home];
		return !!space && !space.readOnly.has(id);
	}

	/** A shared space never sees the user's own data, and its settings and read markers stay out of the diff. */
	#run(home: Home, rule: (data: rules.StoreData) => rules.StoreData) {
		if (home === null) return this.#apply(rule(this.own));
		const space = this.spaces[home];
		if (!space) return;
		const after = { ...storeData(rule(space.data)), reads: [] };
		this.spaces = { ...this.spaces, [home]: { ...space, data: after } };
		this.#persist(home, { ...space.data, settings: DEFAULT_SETTINGS }, { ...after, settings: DEFAULT_SETTINGS });
	}

	#onTask(id: string, rule: (data: rules.StoreData) => rules.StoreData) {
		if (this.canEdit(id)) this.#run(this.homeOf(id), rule);
	}

	task(id: string) {
		return this.#taskById.get(id);
	}

	children(id: string): Task[] {
		return this.#children.get(id) ?? [];
	}

	progress(id: string) {
		return progressOf(this.children(id));
	}

	project(id: string | null) {
		return id ? this.#projectById.get(id) : undefined;
	}

	label(id: string) {
		return this.#labelById.get(id);
	}

	section(id: string | null) {
		return id ? this.#sectionById.get(id) : undefined;
	}

	sectionsOf(projectId: string): Section[] {
		return rules.sectionsOf(this.sections, projectId);
	}

	labelsOf(task: Pick<Task, 'labelIds'>) {
		return task.labelIds.map(id => this.label(id)).filter(label => label !== undefined);
	}

	addTask(input: rules.NewTask, parentId: string | null = null): Task | undefined {
		if (parentId && !this.canEdit(parentId)) return;
		const home = creationHome(this.#homes, input, parentId);
		let task: Task | undefined;
		this.#run(home, data => {
			const result = rules.addTask(data, fitToSpace(data, input), parentId, this.#creation());
			task = result.task;
			return result.data;
		});
		return task;
	}

	updateTask(id: string, patch: rules.TaskPatch) {
		this.#onTask(id, data => rules.updateTask(data, id, fitPatch(data, patch)));
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

	reopenTask(id: string): rules.ReopenedTask[] {
		let reopened: rules.ReopenedTask[] = [];
		this.#onTask(id, data => {
			const result = rules.reopenTask(data, id);
			reopened = result.reopened;
			return result.data;
		});
		return reopened;
	}

	restoreCompletion(previous: readonly rules.CompletionState[]) {
		const first = previous[0];
		if (first) this.#onTask(first.id, data => rules.restoreCompletion(data, previous));
	}

	moveSubtask(id: string, index: number) {
		this.#onTask(id, data => rules.moveSubtask(data, id, index));
	}

	/**
	 * Only in the user's own space: moving a subtask up can carry it out of what a share grants, and the server would
	 * refuse the edit.
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

	deleteProject(id: string): rules.Deleted | undefined {
		if (this.homeOf(id) === null) return this.#delete(rules.deleteProject(this.own, id));
	}

	moveProject(id: string, index: number) {
		if (this.homeOf(id) === null) this.#apply(rules.moveProject(this.own, id, index));
	}

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

	deleteSection(id: string): rules.Deleted | undefined {
		if (this.homeOf(id) === null) return this.#delete(rules.deleteSection(this.own, id));
	}

	addLabel(name: string): Label {
		const { data, label } = rules.addLabel(this.own, name, this.#creation());
		this.#apply(data);
		return label;
	}

	renameLabel(id: string, name: string) {
		if (this.homeOf(id) === null) this.#apply(rules.renameLabel(this.own, id, name));
	}

	/** Null when a label already has the name. */
	savePlace(name: string, place: SavedPlace): Label | null {
		const { data, label } = rules.savePlace(this.own, name, place, this.#creation());
		if (label) this.#apply(data);
		return label;
	}

	setLabelColor(id: string, color: LabelColor) {
		if (this.homeOf(id) === null) this.#apply(rules.setLabelColor(this.own, id, color));
	}

	deleteLabel(id: string): rules.Deleted | undefined {
		if (this.homeOf(id) === null) return this.#delete(rules.deleteLabel(this.own, id));
	}

	#delete(after: rules.StoreData): rules.Deleted {
		const deleted = rules.deletedBetween(this.own, after);
		this.#apply(after);
		return deleted;
	}

	undelete(deleted: rules.Deleted) {
		this.#apply(rules.undelete(this.own, deleted));
	}

	/** One command and one write for the whole backup, however many tasks it holds. */
	importBackup(backup: TodoistBackup): ImportSummary {
		const { state, summary } = mergeBackup(this.own, backup, { newId, now: Date.now() });
		this.#apply({ ...state, tasks: rules.sortTasks(state.tasks) });
		return summary;
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
		const comment = this.#commentById.get(id);
		if (comment) this.#onTask(comment.taskId, data => comments.editComment(data, id, body, me, Date.now()));
	}

	/** Deletes `me`'s own comment and returns it for undo. */
	deleteComment(id: string, me: string): Comment | undefined {
		const comment = this.#commentById.get(id);
		if (comment?.authorId !== me) return undefined;
		this.#onTask(comment.taskId, data => comments.deleteComment(data, id, me));
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

	ownerOf(home: string): Person {
		return this.person(home) ?? { id: home, name: 'Someone', kind: 'human', ownerId: null };
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
		savePeople(this.people);
	}

	markRemindersChecked(at: number) {
		this.remindersCheckedAt = at;
		saveRemindersCheckedAt(at);
	}
}

function keepSpace(previous: SharedSpace | undefined, next: SharedSpace): SharedSpace {
	const data = keepSame(previous?.data ?? emptyData(), next.data);
	const readOnly =
		previous && sameValue([...previous.readOnly].sort(), [...next.readOnly].sort()) ? previous.readOnly : next.readOnly;
	const access = previous && sameValue(previous.access, next.access) ? previous.access : next.access;
	return previous && data === previous.data && readOnly === previous.readOnly && access === previous.access
		? previous
		: { ...next, data, readOnly, access };
}

/** `next` with every entity, list, and the whole data that equal `previous`'s replaced by `previous`'s own. */
function keepSame(previous: rules.StoreData, next: rules.StoreData): rules.StoreData {
	const keep = <T extends { id: string }>(before: readonly T[], after: readonly T[]): T[] => {
		const byId = new Map(before.map(entity => [entity.id, entity]));
		const kept = after.map(entity => {
			const old = byId.get(entity.id);
			return old && sameValue(old, entity) ? old : entity;
		});
		return kept.length === before.length && kept.every((entity, i) => entity === before[i]) ? (before as T[]) : kept;
	};
	const data: rules.StoreData = {
		tasks: keep(previous.tasks, next.tasks),
		projects: keep(previous.projects, next.projects),
		sections: keep(previous.sections, next.sections),
		labels: keep(previous.labels, next.labels),
		comments: keep(previous.comments, next.comments),
		reads: keep(previous.reads, next.reads),
	};
	return (Object.keys(data) as (keyof rules.StoreData)[]).every(key => data[key] === previous[key]) ? previous : data;
}

export const store = new Store();
