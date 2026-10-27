import { ORPCError } from '@orpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Actor } from '../../shared/auth';
import { addComment, commentsOn, deleteComment, editComment } from '../../shared/comments';
import { comments as commentTable, log, tasks as taskTable } from '../../shared/db/schema';
import { newId } from '../../shared/id';
import type { Entities } from '../../shared/dangling';
import {
	DEFAULT_SETTINGS,
	type Comment,
	type Label,
	type Project,
	type Section,
	type Snapshot,
	type Task,
} from '../../shared/model';
import { parseQuickAdd } from '../../shared/quick-add';
import { rowWrites } from '../../shared/rows';
import { authorOnly, filterTree, managesSpace, scopeOf } from '../../shared/scope';
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
	setProjectIcon,
	setPlaceRadius,
	updateTask,
	type Creation,
	type StoreData,
	type TaskPatch,
	sameName,
} from '../../shared/store';
import { applyPickedLabels, isSavedPlace } from '../../shared/triggers';
import type { Client, ClientStamp } from '../../shared/values';
import { wallDate, zonedDateKey } from '../../shared/zoned-time';
import type { Access } from './space';
import type { Db } from './db/sqlite';
import type { Store } from './db/store';
import type { Live } from './live';
import { peopleById, personOf, unknownPerson } from './people';
import { accessIn, entity, loadTree, seesTask, sightOf, storedZone } from './space';
import { serverWrite, syncContext } from './writes';

/**
 * The agent command API: the store's rules run on the server over the space's snapshot, the before and after are
 * diffed into row writes, and those go through `space.write`, the same hooks a device's sync meets, with the caller's
 * standing in the space decided here from the caller's own grants. A command lands whole or not at all.
 * `memo-tasks.ts` writes the same way for Notouroboros.
 */

export type Command = { db: Db; store: Store; live: Live; owner: string; actor: Actor; client: Client; now: number };

/** The owner, or a guest the space is shared with. Anyone else is turned away before reading anything. */
export function requireAccess(db: Db, owner: string, actor: Actor): Access {
	const access = accessIn(db, owner, actor);
	if (!access) throw new ORPCError('FORBIDDEN', { message: 'Not shared with you' });
	return access;
}

function visibleOf(tree: Entities, access: Access) {
	const scope = access.role === 'owner' ? null : scopeOf(tree, access.shares);
	const { tasks, projects, sections, labels } = scope ? filterTree(tree, scope) : tree;
	const readOnly = scope ? tasks.filter(task => !scope.editable.has(task.id)).map(task => task.id) : [];
	return { tasks, projects, sections, labels, readOnly };
}

type Visible = ReturnType<typeof visibleOf>;

const NO_CLIENTS: TaskClients = { created: null, edited: null };

/**
 * Each task's first and latest log rows, which name the app that made it and the one that last changed it: one
 * grouped read of the space's task log, joined back for the two rows. The space is read whole rather than by id,
 * since a Durable Object binds at most 100 parameters.
 */
function clientsOf(db: Db, owner: string, only?: string): Map<string, TaskClients> {
	const ends = db
		.select({
			id: log.id,
			first: sql<number>`min(${log.seq})`.as('first'),
			last: sql<number>`max(${log.seq})`.as('last'),
		})
		.from(log)
		.where(and(eq(log.userId, owner), eq(log.kind, 'task'), only === undefined ? undefined : eq(log.id, only)))
		.groupBy(log.id)
		.as('ends');
	const first = alias(log, 'first_row');
	const latest = alias(log, 'latest_row');
	const rows = db
		.select({
			id: ends.id,
			created: { client: first.client, at: first.at },
			edited: { client: latest.client, at: latest.at },
		})
		.from(ends)
		.innerJoin(first, eq(first.seq, ends.first))
		.innerJoin(latest, eq(latest.seq, ends.last))
		.all();
	const stamp = ({ client, at }: { client: Client | null; at: number }): ClientStamp | null =>
		client ? { ...client, at } : null;
	return new Map(rows.map(row => [row.id, { created: stamp(row.created), edited: stamp(row.edited) }]));
}

function withClients(db: Db, owner: string, tasks: readonly Task[]): AgentTask[] {
	if (!tasks.length) return [];
	const clients = clientsOf(db, owner, tasks.length === 1 ? tasks[0]!.id : undefined);
	return tasks.map(task => ({ ...task, clients: clients.get(task.id) ?? NO_CLIENTS }));
}

export async function view({ db, owner, actor }: Command): Promise<SpaceView> {
	const access = await requireAccess(db, owner, actor);
	const visible = visibleOf(await loadTree(db, owner), access);
	return { ...visible, tasks: withClients(db, owner, visible.tasks) };
}

/**
 * The rows a store rule reads: the tree, the one comment a comment command names, and the time zone. No agent
 * command changes read markers or settings, so neither is loaded and the diff writes neither.
 */
function loadSnapshot(db: Db, owner: string, comment: string | undefined) {
	const tree = loadTree(db, owner);
	const commentRows = comment
		? db
				.select()
				.from(commentTable)
				.where(and(eq(commentTable.userId, owner), eq(commentTable.id, comment)))
				.all()
		: [];
	const zone = storedZone(db, owner);
	const snapshot: Snapshot = { ...tree, comments: commentRows.map(entity), reads: [], settings: DEFAULT_SETTINGS };
	return { snapshot, zone };
}

/** A guest's write outside their share is refused. `comment` names the stored comment the change reads, if any. */
async function run(
	command: Command,
	change: (data: StoreData, visible: Visible, zone: string, access: Access) => StoreData,
	comment?: string,
): Promise<Snapshot> {
	const { db, store, live, owner, actor, client, now } = command;
	const access = requireAccess(db, owner, actor);
	const { snapshot, zone } = loadSnapshot(db, owner, comment);
	const visible = visibleOf(snapshot, access);
	const { settings: _, ...data } = snapshot;
	const after = { ...snapshot, ...change(data, visible, zone, access) };
	const writes = rowWrites(snapshot, after).map(write => serverWrite(write, owner));
	if (!writes.length) return after;
	const manages = access.role === 'guest' && managesSpace(access.shares) ? [owner] : [];
	const { rejected, head } = store.space.write(writes, syncContext(actor, client, { now, manages }), { atomic: true });
	if (rejected.length) throw new ORPCError('FORBIDDEN', { message: rejected[0]!.reason });
	live.publish(head);
	return after;
}

function visibleTask(visible: Visible, id: string): Task {
	const task = visible.tasks.find(task => task.id === id);
	if (!task) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return task;
}

/** The row as stored, since the statement stamped `createdBy` and `completedBy`, which the rule in memory did not. */
function taskAfter({ db, owner }: Command, id: string): AgentTask {
	const row = db
		.select()
		.from(taskTable)
		.where(and(eq(taskTable.userId, owner), eq(taskTable.id, id)))
		.get();
	if (!row) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	return withClients(db, owner, [entity(row) as Task])[0]!;
}

/** `text` is read like the app's quick add, against the space's projects and labels; explicit fields win over it. */
export async function createTask(command: Command, input: AgentNewTask): Promise<AgentTask> {
	const id = newId();
	await run(command, (data, visible, zone) => {
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
	return taskAfter(command, id);
}

/**
 * A saved place in `labelIds` becomes the task's place, as in the apps. Ids without one leave its place alone. A
 * subtask follows its root's project, so a project on one is refused rather than written and then ignored.
 */
export async function editTask(command: Command, id: string, patch: TaskPatch): Promise<AgentTask> {
	await run(command, (data, visible) => {
		const task = visibleTask(visible, id);
		if (task.parentId && patch.projectId !== undefined) {
			throw new ORPCError('BAD_REQUEST', { message: 'A subtask follows its parent’s project' });
		}
		if ((patch.due || patch.recurrence) && (patch.event ?? task.event)) {
			throw new ORPCError('BAD_REQUEST', { message: 'An event stands in for the date and the repeat' });
		}
		const ids = patch.labelIds ?? [];
		const placed = visible.labels.some(l => isSavedPlace(l) && ids.includes(l.id))
			? applyPickedLabels(visible.labels, ids, patch.location ?? task.location)
			: {};
		return updateTask(data, id, { ...patch, ...placed });
	});
	return taskAfter(command, id);
}

export async function finishTask(command: Command, id: string): Promise<AgentTask> {
	await run(command, (data, visible, zone) => {
		visibleTask(visible, id);
		return completeTask(data, id, zonedDateKey(command.now, zone), command.now, zone)?.data ?? data;
	});
	return taskAfter(command, id);
}

export async function reopen(command: Command, id: string): Promise<AgentTask> {
	await run(command, (data, visible) => {
		visibleTask(visible, id);
		return reopenTask(data, id).data;
	});
	return taskAfter(command, id);
}

export async function removeTask(command: Command, id: string): Promise<void> {
	await run(command, (data, visible) => {
		visibleTask(visible, id);
		return deleteTask(data, id).data;
	});
}

export async function listComments({ db, owner, actor }: Command, taskId: string): Promise<TaskComment[]> {
	const access = await requireAccess(db, owner, actor);
	const sight = sightOf(actor, access);
	const seen = seesTask(db, owner, sight, taskId);
	const rows = db
		.select()
		.from(commentTable)
		.where(and(eq(commentTable.userId, owner), eq(commentTable.taskId, taskId)))
		.all();
	if (!seen) throw new ORPCError('NOT_FOUND', { message: 'No such task' });
	const comments = commentsOn(rows.map(entity), taskId);
	const authors = await peopleById(
		db,
		comments.flatMap(comment => (comment.authorId ? [comment.authorId] : [])),
	);
	return comments.map(comment => ({
		...comment,
		author: authors.get(comment.authorId ?? '') ?? unknownPerson(comment.authorId ?? ''),
	}));
}

async function commentAfter({ db }: Command, snapshot: Snapshot, id: string): Promise<TaskComment> {
	const comment = snapshot.comments.find(comment => comment.id === id);
	if (!comment) throw new ORPCError('NOT_FOUND', { message: 'No such comment' });
	return { ...comment, author: await personOf(db, comment.authorId ?? '') };
}

/** The caller's own comment on a task it can see. Someone else's is refused; a hidden one is not found. */
function ownComment(data: StoreData, visible: Visible, id: string, actor: string, op: 'patch' | 'delete'): Comment {
	const comment = data.comments.find(comment => comment.id === id);
	if (!comment || !visible.tasks.some(task => task.id === comment.taskId)) {
		throw new ORPCError('NOT_FOUND', { message: 'No such comment' });
	}
	if (comment.authorId !== actor) throw new ORPCError('FORBIDDEN', { message: authorOnly(op) });
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
	const snapshot = await run(
		command,
		(data, visible) => {
			ownComment(data, visible, id, command.actor.id, 'patch');
			return editComment(data, id, body, command.actor.id, command.now);
		},
		id,
	);
	return commentAfter(command, snapshot, id);
}

export async function removeComment(command: Command, id: string): Promise<void> {
	await run(
		command,
		(data, visible) => {
			ownComment(data, visible, id, command.actor.id, 'delete');
			return deleteComment(data, id, command.actor.id);
		},
		id,
	);
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
 * Names are unique ignoring case, in the space for projects and labels and in the project for sections, because
 * quick add resolves `#name`, `/name`, and `@name` to one: a taken name returns the existing one on create, so an
 * agent's retry never duplicates it, and is refused on rename. A name is trimmed and may not be blank.
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

export async function createProject(command: Command, name: string): Promise<Project> {
	const title = named(name, 'project');
	let id = newId();
	const snapshot = await run(command, (data, _visible, _zone, access) => {
		requireManager(access);
		const added = addProject(data, title, { id, now: command.now });
		id = added.project.id;
		return added.data;
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
			next = renameProject(next, id, title);
			if (next === data && visibleIn(data.projects, id, 'project').name !== title)
				throw new ORPCError('BAD_REQUEST', { message: 'Another project has that name' });
		}
		if (edit.icon !== undefined) next = setProjectIcon(next, id, edit.icon);
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
		const existing = data.labels.find(label => sameName(label.name, name));
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
