import { ORPCError } from '@orpc/server';
import { addComment, commentsOn, deleteComment, editComment } from '../../../shared/comments';
import type {
	AgentNewTask,
	AgentTask,
	LabelEdit,
	NewComment,
	NewLabel,
	NewSection,
	ProjectEdit,
	SectionEdit,
	SpaceView,
	TaskClients,
	TaskComment,
} from '../../../shared/sharing';
import { newId } from '../../../shared/id';
import { parseQuickAdd } from '../../../shared/quick-add';
import { admit, managesSpace, type Grant } from '../../../shared/scope';
import {
	addLabel,
	addProject,
	addSection,
	addTask,
	completeTask,
	deleteLabel,
	deleteProject,
	deleteSection,
	deleteTask,
	moveProject,
	moveSection,
	renameLabel,
	renameProject,
	renameSection,
	reopenTask,
	setLabelColor,
	updateTask,
	type Creation,
	type StoreData,
	type TaskPatch,
} from '../../../shared/store';
import { diff, stamp } from '../../../shared/sync/diff';
import { serverSnapshot } from '../../../shared/sync/merge';
import type { Comment, Label, Project, Section, Snapshot, Task } from '../../../shared/sync/protocol';
import type { Client } from '../../../shared/values';
import { isTimeZone, wallDate, zonedDateKey } from '../../../shared/zoned-time';
import type { Access } from '../auth';
import { personOf } from './activity';
import type { AccountStore } from './store';
import { guestView, loadState, push } from './sync';

/**
 * The agent command API: the store's rules run on the server over the space's snapshot, diffed, stamped, and pushed
 * through the same merge and the same admission a guest's synced ops meet. `memo-tasks.ts` is the same shape for
 * Notouroboros.
 */

type Space = { store: AccountStore; now: number; actor: string; client: Client; access: Access };

const grantsOf = (access: Access): readonly Grant[] | null => (access.role === 'owner' ? null : access.shares);

/** What the actor sees of the space. Owners see everything and may edit it all. */
function visibleOf(snapshot: Snapshot, access: Access) {
	const grants = grantsOf(access);
	const { filtered, readOnly } = grants ? guestView(snapshot, grants) : { filtered: snapshot, readOnly: [] };
	const { tasks, projects, sections, labels } = filtered;
	return { tasks, projects, sections, labels, readOnly };
}

type Visible = ReturnType<typeof visibleOf>;

const NO_CLIENTS: TaskClients = { created: null, edited: null };

function withClients(store: AccountStore, tasks: readonly Task[]): AgentTask[] {
	return tasks.map(task => {
		const row = store.taskClients(task.id);
		return { ...task, clients: row ? { created: row.created, edited: row.edited } : NO_CLIENTS };
	});
}

export function view({ store, access }: Space): SpaceView {
	const visible = visibleOf(serverSnapshot(loadState(store)), access);
	return { ...visible, tasks: withClients(store, visible.tasks) };
}

const zoneOf = (snapshot: Snapshot) =>
	snapshot.settings.timeZone && isTimeZone(snapshot.settings.timeZone) ? snapshot.settings.timeZone : 'UTC';

function run(space: Space, command: (data: StoreData, visible: Visible, zone: string) => StoreData): Snapshot {
	const { store, now, actor, client, access } = space;
	return store.transaction(() => {
		const before = loadState(store);
		const snapshot = serverSnapshot(before);
		const visible = visibleOf(snapshot, access);
		const { settings: _, ...data } = snapshot;
		const next = command(data, visible, zoneOf(snapshot));
		const patches = diff(snapshot, { ...snapshot, ...next });
		const { ops } = stamp(patches, before.clock, now);
		const grants = grantsOf(access);
		if (grants && admit(snapshot, grants, ops, actor).refused.length) {
			throw new ORPCError('FORBIDDEN', { message: 'Not editable in this share' });
		}
		return serverSnapshot(push(store, before, ops, now, actor, client).state);
	});
}

function visibleTask(visible: Visible, id: string): Task {
	const task = visible.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return task;
}

function taskAfter(store: AccountStore, snapshot: Snapshot, id: string): AgentTask {
	const task = snapshot.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return withClients(store, [task])[0]!;
}

/** `text` is read like the app's quick add, against the space's projects and labels; explicit fields win over it. */
export function createTask(space: Space, input: AgentNewTask): AgentTask {
	const id = newId();
	const snapshot = run(space, (data, visible, zone) => {
		const parsed = input.text
			? parseQuickAdd(input.text, {
					now: wallDate(space.now, zone),
					projects: visible.projects,
					sections: visible.sections,
					labels: visible.labels,
					projectId: input.projectId ?? null,
				})
			: null;
		const title = (input.title ?? parsed?.title ?? '').trim();
		if (!title) throw new ORPCError('BAD_REQUEST', { message: 'A task needs a title' });
		if (input.parentId) visibleTask(visible, input.parentId);
		const creation: Creation = { id, now: space.now };
		const added = addTask(
			data,
			{
				title,
				projectId: input.projectId ?? parsed?.projectId ?? null,
				sectionId: input.sectionId ?? parsed?.sectionId ?? null,
				labelIds: input.labelIds ?? parsed?.labelIds ?? [],
				due: parsed?.due ?? null,
				recurrence: parsed?.recurrence ?? null,
				priority: input.priority ?? parsed?.priority ?? null,
				reminders: parsed?.reminders ?? [],
			},
			input.parentId ?? null,
			creation,
		);
		return input.notes ? updateTask(added.data, id, { notes: input.notes }) : added.data;
	});
	return taskAfter(space.store, snapshot, id);
}

export function editTask(space: Space, id: string, patch: TaskPatch): AgentTask {
	const snapshot = run(space, (data, visible) => {
		visibleTask(visible, id);
		return updateTask(data, id, patch);
	});
	return taskAfter(space.store, snapshot, id);
}

export function finishTask(space: Space, id: string): AgentTask {
	const snapshot = run(space, (data, visible, zone) => {
		visibleTask(visible, id);
		return completeTask(data, id, zonedDateKey(space.now, zone), space.now)?.data ?? data;
	});
	return taskAfter(space.store, snapshot, id);
}

export function reopen(space: Space, id: string): AgentTask {
	const snapshot = run(space, (data, visible) => {
		visibleTask(visible, id);
		return reopenTask(data, id);
	});
	return taskAfter(space.store, snapshot, id);
}

export function removeTask(space: Space, id: string): void {
	run(space, (data, visible) => {
		visibleTask(visible, id);
		return deleteTask(data, id).data;
	});
}

const withAuthor = (store: AccountStore, comment: Comment): TaskComment => ({
	...comment,
	author: personOf(store, comment.authorId ?? ''),
});

export function listComments(space: Space, taskId: string): TaskComment[] {
	const snapshot = serverSnapshot(loadState(space.store));
	visibleTask(visibleOf(snapshot, space.access), taskId);
	return commentsOn(snapshot.comments, taskId).map(comment => withAuthor(space.store, comment));
}

function commentAfter(space: Space, snapshot: Snapshot, id: string): TaskComment {
	const comment = snapshot.comments.find(comment => comment.id === id);
	if (!comment) throw new ORPCError('NOT_FOUND', { message: 'No such comment' });
	return withAuthor(space.store, comment);
}

/** The caller's own comment on a task it can see. Someone else's is refused; a hidden one is not found. */
function ownComment(data: StoreData, visible: Visible, id: string, actor: string): Comment {
	const comment = data.comments.find(comment => comment.id === id);
	if (!comment || !visible.tasks.some(task => task.id === comment.taskId)) {
		throw new ORPCError('NOT_FOUND', { message: 'No such comment' });
	}
	if (comment.authorId !== actor) throw new ORPCError('FORBIDDEN', { message: 'Only the author can change it' });
	return comment;
}

export function createComment(space: Space, input: NewComment): TaskComment {
	const id = newId();
	const snapshot = run(space, (data, visible) => {
		visibleTask(visible, input.taskId);
		const added = addComment(data, input.taskId, input.body, space.actor, { id, now: space.now });
		if (!added.comment) throw new ORPCError('BAD_REQUEST', { message: 'A comment needs a body' });
		return added.data;
	});
	return commentAfter(space, snapshot, id);
}

export function updateComment(space: Space, id: string, body: string): TaskComment {
	if (!body.trim()) throw new ORPCError('BAD_REQUEST', { message: 'A comment needs a body' });
	const snapshot = run(space, (data, visible) => {
		ownComment(data, visible, id, space.actor);
		return editComment(data, id, body, space.actor, space.now);
	});
	return commentAfter(space, snapshot, id);
}

export function removeComment(space: Space, id: string): void {
	run(space, (data, visible) => {
		ownComment(data, visible, id, space.actor);
		return deleteComment(data, id, space.actor);
	});
}

/**
 * Projects, sections, labels, and links are the owner's and a manager's. Checked before any lookup, because a name
 * clash read against the whole space would tell a guest what it cannot see.
 */
export function requireManager(access: Access) {
	if (access.role !== 'owner' && !managesSpace(access.shares)) {
		throw new ORPCError('FORBIDDEN', { message: 'Only the owner or a manager of the space can do this' });
	}
}

/**
 * The sync fixups merge projects that share a name ignoring case, as they do sections in a project and labels, so a
 * taken name returns the existing one on create and is refused on rename. A name is trimmed and may not be blank.
 */

function named(name: string, what: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new ORPCError('BAD_REQUEST', { message: `A ${what} needs a name` });
	return trimmed;
}

function visibleIn<T extends { id: string }>(list: readonly T[], id: string, what: string): T {
	const found = list.find(item => item.id === id);
	if (!found) throw new ORPCError('NOT_FOUND', { message: `No such ${what}` });
	return found;
}

const sameName = <T extends { id: string; name: string }>(list: readonly T[], name: string, except?: string) =>
	list.find(item => item.id !== except && item.name.toLowerCase() === name.toLowerCase());

export function createProject(space: Space, name: string): Project {
	requireManager(space.access);
	const title = named(name, 'project');
	let id = newId();
	const snapshot = run(space, data => {
		const existing = sameName(data.projects, title);
		if (existing) {
			id = existing.id;
			return data;
		}
		return addProject(data, title, { id, now: space.now }).data;
	});
	return visibleIn(snapshot.projects, id, 'project');
}

export function editProject(space: Space, id: string, edit: ProjectEdit): Project {
	requireManager(space.access);
	const title = edit.name === undefined ? undefined : named(edit.name, 'project');
	const snapshot = run(space, (data, visible) => {
		visibleIn(visible.projects, id, 'project');
		let next = data;
		if (title !== undefined) {
			if (sameName(data.projects, title, id))
				throw new ORPCError('BAD_REQUEST', { message: 'Another project has that name' });
			next = renameProject(next, id, title);
		}
		return edit.index === undefined ? next : moveProject(next, id, edit.index);
	});
	return visibleIn(snapshot.projects, id, 'project');
}

export function removeProject(space: Space, id: string): void {
	requireManager(space.access);
	run(space, (data, visible) => {
		visibleIn(visible.projects, id, 'project');
		return deleteProject(data, id);
	});
}

export function createSection(space: Space, input: NewSection): Section {
	requireManager(space.access);
	const name = named(input.name, 'section');
	let id = newId();
	const snapshot = run(space, (data, visible) => {
		visibleIn(visible.projects, input.projectId, 'project');
		const added = addSection(data, input.projectId, name, { id, now: space.now });
		id = added.section.id;
		return added.data;
	});
	return visibleIn(snapshot.sections, id, 'section');
}

export function editSection(space: Space, id: string, edit: SectionEdit): Section {
	requireManager(space.access);
	const name = edit.name === undefined ? undefined : named(edit.name, 'section');
	const snapshot = run(space, (data, visible) => {
		visibleIn(visible.sections, id, 'section');
		let next = data;
		if (name !== undefined) {
			next = renameSection(next, id, name);
			if (next === data)
				throw new ORPCError('BAD_REQUEST', { message: 'Another section in the project has that name' });
		}
		return edit.index === undefined ? next : moveSection(next, id, edit.index);
	});
	return visibleIn(snapshot.sections, id, 'section');
}

export function removeSection(space: Space, id: string): void {
	requireManager(space.access);
	run(space, (data, visible) => {
		visibleIn(visible.sections, id, 'section');
		return deleteSection(data, id);
	});
}

export function createLabel(space: Space, input: NewLabel): Label {
	requireManager(space.access);
	const name = named(input.name, 'label');
	let id = newId();
	const snapshot = run(space, data => {
		const existing = sameName(data.labels, name);
		const added = existing ? { data, label: existing } : addLabel(data, name, { id, now: space.now });
		id = added.label.id;
		return input.color ? setLabelColor(added.data, id, input.color) : added.data;
	});
	return visibleIn(snapshot.labels, id, 'label');
}

export function editLabel(space: Space, id: string, edit: LabelEdit): Label {
	requireManager(space.access);
	const name = edit.name === undefined ? undefined : named(edit.name, 'label');
	const snapshot = run(space, (data, visible) => {
		visibleIn(visible.labels, id, 'label');
		let next = data;
		if (name !== undefined) {
			next = renameLabel(next, id, name);
			if (next === data) throw new ORPCError('BAD_REQUEST', { message: 'Another label has that name' });
		}
		return edit.color ? setLabelColor(next, id, edit.color) : next;
	});
	return visibleIn(snapshot.labels, id, 'label');
}

export function removeLabel(space: Space, id: string): void {
	requireManager(space.access);
	run(space, (data, visible) => {
		visibleIn(visible.labels, id, 'label');
		return deleteLabel(data, id);
	});
}
