import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../shared/auth';
import { addComment, commentsOn, deleteComment, editComment } from '../../shared/comments';
import { people, taskClients } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import type { Comment, Label, Project, Section, Snapshot, Task } from '../../shared/model';
import { parseQuickAdd } from '../../shared/quick-add';
import { rowWrites } from '../../shared/rows';
import { filterSnapshot, managesSpace, scopeOf, type Grant } from '../../shared/scope';
import type {
	AgentNewTask,
	AgentTask,
	LabelEdit,
	NewComment,
	NewLabel,
	NewSection,
	Person,
	ProjectEdit,
	SectionEdit,
	SpaceView,
	TaskClients,
	TaskComment,
} from '../../shared/sharing';
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
	savePlace,
	setLabelColor,
	setPlaceRadius,
	updateTask,
	type Creation,
	type StoreData,
	type TaskPatch,
} from '../../shared/store';
import { applyPickedLabels, isSavedPlace } from '../../shared/triggers';
import type { Client } from '../../shared/values';
import { wallDate, zonedDateKey } from '../../shared/zoned-time';
import type { Access } from './auth';
import type { Db } from './db/postgres';
import { zoneOf } from './push';
import { accessOf, loadSpace, type Space } from './space';
import { transact, type Write } from './writes';

/**
 * The agent command API: the store's rules run on the server over the space's snapshot, the before and after are
 * diffed into row writes, and those go through `transact`, the same admission, stamps, and repairs a client's upload
 * meets. `memo-tasks.ts` is the same shape for Notouroboros.
 */

export type Command = { db: Db; owner: string; actor: Actor; client: Client; now: number };

/** The owner, or a guest the space is shared with. Anyone else is turned away before reading anything. */
export function requireAccess(space: Space, actor: Actor): Access {
	const access = accessOf(space, actor);
	if (!access) throw new ORPCError('FORBIDDEN', { message: 'Not shared with you' });
	return access;
}

export function guestView(snapshot: Snapshot, grants: readonly Grant[]) {
	const scope = scopeOf(snapshot, grants);
	const filtered = filterSnapshot(snapshot, scope);
	const readOnly = filtered.tasks.filter(task => !scope.editable.has(task.id)).map(task => task.id);
	return { scope, filtered, readOnly };
}

function visibleOf(snapshot: Snapshot, access: Access) {
	const { filtered, readOnly } =
		access.role === 'owner' ? { filtered: snapshot, readOnly: [] } : guestView(snapshot, access.shares);
	const { tasks, projects, sections, labels } = filtered;
	return { tasks, projects, sections, labels, readOnly };
}

type Visible = ReturnType<typeof visibleOf>;

const NO_CLIENTS: TaskClients = { created: null, edited: null };

async function withClients(db: Db, owner: string, tasks: readonly Task[]): Promise<AgentTask[]> {
	if (!tasks.length) return [];
	const rows = await db
		.select()
		.from(taskClients)
		.where(
			and(
				eq(taskClients.userId, owner),
				inArray(
					taskClients.id,
					tasks.map(task => task.id),
				),
			),
		);
	const byId = new Map(rows.map(row => [row.id, { created: row.created, edited: row.edited }]));
	return tasks.map(task => ({ ...task, clients: byId.get(task.id) ?? NO_CLIENTS }));
}

export function unknownPerson(id: string): Person {
	return { id, name: '', kind: 'human', ownerId: null };
}

export async function personOf(db: Db, owner: string, id: string): Promise<Person> {
	const [row] = await db
		.select()
		.from(people)
		.where(and(eq(people.userId, owner), eq(people.id, id)));
	return row ? { id: row.id, name: row.name, kind: row.kind, ownerId: row.ownerId } : unknownPerson(id);
}

export async function view({ db, owner, actor }: Command): Promise<SpaceView> {
	const space = await loadSpace(db, owner);
	const visible = visibleOf(space.snapshot, requireAccess(space, actor));
	return { ...visible, tasks: await withClients(db, owner, visible.tasks) };
}

/** A guest's write outside their share is refused. */
async function run(
	command: Command,
	change: (data: StoreData, visible: Visible, zone: string, access: Access) => StoreData,
): Promise<Snapshot> {
	const { db, owner, actor, client, now } = command;
	const { rejected, fixed } = await transact(db, owner, { actor, client, now }, space => {
		const access = requireAccess(space, actor);
		const { snapshot } = space;
		const visible = visibleOf(snapshot, access);
		const { settings: _, ...data } = snapshot;
		const next = change(data, visible, zoneOf(snapshot), access);
		return rowWrites(snapshot, { ...snapshot, ...next }) as Write[];
	});
	if (rejected.length) throw new ORPCError('FORBIDDEN', { message: 'Not editable in this share' });
	return fixed;
}

function visibleTask(visible: Visible, id: string): Task {
	const task = visible.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return task;
}

async function taskAfter({ db, owner }: Command, snapshot: Snapshot, id: string): Promise<AgentTask> {
	const task = snapshot.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return (await withClients(db, owner, [task]))[0]!;
}

/** `text` is read like the app's quick add, against the space's projects and labels; explicit fields win over it. */
export async function createTask(command: Command, input: AgentNewTask): Promise<AgentTask> {
	const id = newId();
	const snapshot = await run(command, (data, visible, zone) => {
		const parsed = input.text
			? parseQuickAdd(input.text, {
					now: wallDate(command.now, zone),
					projects: visible.projects,
					sections: visible.sections,
					labels: visible.labels,
					projectId: input.projectId ?? null,
				})
			: null;
		const title = (input.title ?? parsed?.title ?? '').trim();
		if (!title) throw new ORPCError('BAD_REQUEST', { message: 'A task needs a title' });
		if (input.parentId) visibleTask(visible, input.parentId);
		const creation: Creation = { id, now: command.now };
		const placed = applyPickedLabels(visible.labels, input.labelIds ?? parsed?.labelIds ?? [], null);
		const added = addTask(
			data,
			{
				title,
				projectId: input.projectId ?? parsed?.projectId ?? null,
				sectionId: input.sectionId ?? parsed?.sectionId ?? null,
				labelIds: placed.labelIds,
				due: parsed?.due ?? null,
				recurrence: parsed?.recurrence ?? null,
				priority: input.priority ?? parsed?.priority ?? null,
				reminders: parsed?.reminders ?? [],
				location: placed.location ?? parsed?.location ?? null,
			},
			input.parentId ?? null,
			creation,
		);
		return input.notes ? updateTask(added.data, id, { notes: input.notes }) : added.data;
	});
	return taskAfter(command, snapshot, id);
}

/** A saved place in `labelIds` becomes the task's place, as in the apps. Ids without one leave its place alone. */
export async function editTask(command: Command, id: string, patch: TaskPatch): Promise<AgentTask> {
	const snapshot = await run(command, (data, visible) => {
		const task = visibleTask(visible, id);
		const ids = patch.labelIds ?? [];
		const placed = visible.labels.some(l => isSavedPlace(l) && ids.includes(l.id))
			? applyPickedLabels(visible.labels, ids, patch.location ?? task.location)
			: {};
		return updateTask(data, id, { ...patch, ...placed });
	});
	return taskAfter(command, snapshot, id);
}

export async function finishTask(command: Command, id: string): Promise<AgentTask> {
	const snapshot = await run(command, (data, visible, zone) => {
		visibleTask(visible, id);
		return completeTask(data, id, zonedDateKey(command.now, zone), command.now)?.data ?? data;
	});
	return taskAfter(command, snapshot, id);
}

export async function reopen(command: Command, id: string): Promise<AgentTask> {
	const snapshot = await run(command, (data, visible) => {
		visibleTask(visible, id);
		return reopenTask(data, id);
	});
	return taskAfter(command, snapshot, id);
}

export async function removeTask(command: Command, id: string): Promise<void> {
	await run(command, (data, visible) => {
		visibleTask(visible, id);
		return deleteTask(data, id).data;
	});
}

const withAuthor = async (db: Db, owner: string, comment: Comment): Promise<TaskComment> => ({
	...comment,
	author: await personOf(db, owner, comment.authorId ?? ''),
});

export async function listComments({ db, owner, actor }: Command, taskId: string): Promise<TaskComment[]> {
	const space = await loadSpace(db, owner);
	visibleTask(visibleOf(space.snapshot, requireAccess(space, actor)), taskId);
	return Promise.all(commentsOn(space.snapshot.comments, taskId).map(comment => withAuthor(db, owner, comment)));
}

async function commentAfter({ db, owner }: Command, snapshot: Snapshot, id: string): Promise<TaskComment> {
	const comment = snapshot.comments.find(comment => comment.id === id);
	if (!comment) throw new ORPCError('NOT_FOUND', { message: 'No such comment' });
	return withAuthor(db, owner, comment);
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

export async function createComment(command: Command, input: NewComment): Promise<TaskComment> {
	const id = newId();
	const snapshot = await run(command, (data, visible) => {
		visibleTask(visible, input.taskId);
		const added = addComment(data, input.taskId, input.body, command.actor.id, { id, now: command.now });
		if (!added.comment) throw new ORPCError('BAD_REQUEST', { message: 'A comment needs a body' });
		return added.data;
	});
	return commentAfter(command, snapshot, id);
}

export async function updateComment(command: Command, id: string, body: string): Promise<TaskComment> {
	if (!body.trim()) throw new ORPCError('BAD_REQUEST', { message: 'A comment needs a body' });
	const snapshot = await run(command, (data, visible) => {
		ownComment(data, visible, id, command.actor.id);
		return editComment(data, id, body, command.actor.id, command.now);
	});
	return commentAfter(command, snapshot, id);
}

export async function removeComment(command: Command, id: string): Promise<void> {
	await run(command, (data, visible) => {
		ownComment(data, visible, id, command.actor.id);
		return deleteComment(data, id, command.actor.id);
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
 * The fixups merge projects that share a name ignoring case, as they do sections in a project and labels, so a taken
 * name returns the existing one on create and is refused on rename. A name is trimmed and may not be blank.
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

export async function createProject(command: Command, name: string): Promise<Project> {
	const title = named(name, 'project');
	let id = newId();
	const snapshot = await run(command, (data, _visible, _zone, access) => {
		requireManager(access);
		const existing = sameName(data.projects, title);
		if (existing) {
			id = existing.id;
			return data;
		}
		return addProject(data, title, { id, now: command.now }).data;
	});
	return visibleIn(snapshot.projects, id, 'project');
}

export async function editProject(command: Command, id: string, edit: ProjectEdit): Promise<Project> {
	const title = edit.name === undefined ? undefined : named(edit.name, 'project');
	const snapshot = await run(command, (data, visible, _zone, access) => {
		requireManager(access);
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

export async function removeProject(command: Command, id: string): Promise<void> {
	await run(command, (data, visible, _zone, access) => {
		requireManager(access);
		visibleIn(visible.projects, id, 'project');
		return deleteProject(data, id);
	});
}

export async function createSection(command: Command, input: NewSection): Promise<Section> {
	const name = named(input.name, 'section');
	let id = newId();
	const snapshot = await run(command, (data, visible, _zone, access) => {
		requireManager(access);
		visibleIn(visible.projects, input.projectId, 'project');
		const added = addSection(data, input.projectId, name, { id, now: command.now });
		id = added.section.id;
		return added.data;
	});
	return visibleIn(snapshot.sections, id, 'section');
}

export async function editSection(command: Command, id: string, edit: SectionEdit): Promise<Section> {
	const name = edit.name === undefined ? undefined : named(edit.name, 'section');
	const snapshot = await run(command, (data, visible, _zone, access) => {
		requireManager(access);
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

export async function removeSection(command: Command, id: string): Promise<void> {
	await run(command, (data, visible, _zone, access) => {
		requireManager(access);
		visibleIn(visible.sections, id, 'section');
		return deleteSection(data, id);
	});
}

export async function createLabel(command: Command, input: NewLabel): Promise<Label> {
	const name = named(input.name, 'label');
	let id = newId();
	const snapshot = await run(command, (data, _visible, _zone, access) => {
		requireManager(access);
		const existing = sameName(data.labels, name);
		if (existing && input.place && !existing.place)
			throw new ORPCError('BAD_REQUEST', { message: 'A label that is not a place has that name' });
		if (existing) id = existing.id;
		const next = existing
			? data
			: input.place
				? savePlace(data, name, input.place, { id, now: command.now }).data
				: addLabel(data, name, { id, now: command.now }).data;
		return input.color ? setLabelColor(next, id, input.color) : next;
	});
	return visibleIn(snapshot.labels, id, 'label');
}

export async function editLabel(command: Command, id: string, edit: LabelEdit): Promise<Label> {
	const name = edit.name === undefined ? undefined : named(edit.name, 'label');
	const snapshot = await run(command, (data, visible, _zone, access) => {
		requireManager(access);
		const label = visibleIn(visible.labels, id, 'label');
		if (edit.radius !== undefined && !label.place)
			throw new ORPCError('BAD_REQUEST', { message: 'Only a saved place has a radius' });
		let next = data;
		if (name !== undefined) {
			next = renameLabel(next, id, name);
			if (next === data) throw new ORPCError('BAD_REQUEST', { message: 'Another label has that name' });
		}
		if (edit.radius !== undefined) next = setPlaceRadius(next, id, edit.radius);
		return edit.color ? setLabelColor(next, id, edit.color) : next;
	});
	return visibleIn(snapshot.labels, id, 'label');
}

export async function removeLabel(command: Command, id: string): Promise<void> {
	await run(command, (data, visible, _zone, access) => {
		requireManager(access);
		visibleIn(visible.labels, id, 'label');
		return deleteLabel(data, id);
	});
}
