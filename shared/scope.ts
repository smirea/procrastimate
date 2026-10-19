import type { Entities, Links } from './dangling.ts';
import type { AccessRow, ShareRow } from './db/schema.ts';
import type { FieldsByKind } from './model.ts';
import type { RowWrite } from './rows.ts';

/**
 * What a guest reaches in a space: `scopeOf` computes it from the owner's shares and rows, and the server stores the
 * result as `access` rows, which `guestRefusal` then checks a guest's write against. Server only, never ported:
 * clients see only the rows the `access` table lets PowerSync stream them. See `docs/decisions/sharing.md`.
 */

export type Grant = Pick<ShareRow, 'targetKind' | 'targetId' | 'role'>;

type LinkedTask = Links['tasks'][number];

/**
 * A whole-space edit share makes its holder a manager of the space. Only AI accounts can hold one; `shares.create`
 * refuses the whole space to anyone else. A manager sees every project and label, writes them and sections like the
 * owner, and makes public links.
 */
export const managesSpace = (grants: readonly Grant[]) =>
	grants.some(grant => grant.targetKind === 'space' && grant.role === 'edit');

export type Scope = {
	/** Every task the grants reach, directly or as a descendant. */
	tasks: ReadonlySet<string>;
	/** The subset reached through an `edit` share. */
	editable: ReadonlySet<string>;
	/** The shared projects and labels, plus every one a visible task references. */
	projects: ReadonlySet<string>;
	labels: ReadonlySet<string>;
	/** Every section of a project in `projects`, since a section follows its project's visibility. */
	sections: ReadonlySet<string>;
};

/**
 * `snapshot` is read as `resolveDangling` leaves it, which every loader applies: a subtask carries its root's
 * project, so a project share reaches it by its own `projectId`.
 */
export function scopeOf(snapshot: Links, grants: readonly Grant[]): Scope {
	const children = Map.groupBy(snapshot.tasks, task => task.parentId);
	const reaches = ({ targetKind, targetId }: Grant, task: LinkedTask) => {
		switch (targetKind) {
			case 'space':
				return true;
			case 'project':
				return task.projectId === targetId;
			case 'label':
				return task.labelIds.includes(targetId);
			case 'task':
				return task.id === targetId;
		}
	};
	const live = {
		projects: new Set(snapshot.projects.map(project => project.id)),
		labels: new Set(snapshot.labels.map(label => label.id)),
	};
	const tasks = new Set<string>();
	const editable = new Set<string>();
	const projects = new Set<string>();
	const labels = new Set<string>();
	for (const grant of grants) {
		const into = grant.role === 'edit' ? [tasks, editable] : [tasks];
		const queue = snapshot.tasks.filter(task => reaches(grant, task));
		while (queue.length) {
			const task = queue.pop()!;
			for (const set of into) set.add(task.id);
			queue.push(...(children.get(task.id) ?? []));
		}
		if (grant.targetKind === 'project' && live.projects.has(grant.targetId)) projects.add(grant.targetId);
		if (grant.targetKind === 'label' && live.labels.has(grant.targetId)) labels.add(grant.targetId);
		if (grant.targetKind === 'space' && grant.role === 'edit') {
			for (const { id } of snapshot.projects) projects.add(id);
			for (const { id } of snapshot.labels) labels.add(id);
		}
	}
	for (const task of snapshot.tasks) {
		if (!tasks.has(task.id)) continue;
		if (task.projectId) projects.add(task.projectId);
		for (const labelId of task.labelIds) labels.add(labelId);
	}
	const sections = new Set(snapshot.sections.filter(s => projects.has(s.projectId)).map(s => s.id));
	return { tasks, editable, projects, labels, sections };
}

/** The tree as the guest sees it. */
export function filterTree(tree: Entities, scope: Scope): Entities {
	return {
		tasks: tree.tasks.filter(task => scope.tasks.has(task.id)),
		projects: tree.projects.filter(project => scope.projects.has(project.id)),
		sections: tree.sections.filter(section => scope.sections.has(section.id)),
		labels: tree.labels.filter(label => scope.labels.has(label.id)),
	};
}

/** The guest's `access` rows in one space, as `guestRefusal` reads them. */
export type GuestRows = readonly Pick<AccessRow, 'kind' | 'entityId' | 'role'>[];

export type TaskFields = Partial<FieldsByKind['task']>;
export type CommentFields = Partial<FieldsByKind['comment']>;

/** Why someone else's comment is refused: only its author edits or deletes it. */
export const authorOnly = (op: RowWrite['op']) =>
	op === 'delete' ? 'Only the author can delete a comment' : 'Only the author can edit a comment';

const roleOf = (rows: GuestRows, kind: AccessRow['kind'], id: string) =>
	rows.find(row => row.kind === kind && row.entityId === id)?.role;

/**
 * A guest's write may only point at what the guest can already see: a parent it may edit, and projects, sections, and
 * labels among its rows, so it cannot graft its task onto the owner's private tree or pull hidden names into its
 * view.
 */
function pointsOutside(fields: TaskFields, rows: GuestRows): boolean {
	const { parentId, projectId, sectionId, labelIds } = fields;
	if (parentId && roleOf(rows, 'task', parentId) !== 'edit') return true;
	if (projectId && !roleOf(rows, 'project', projectId)) return true;
	if (sectionId && !roleOf(rows, 'section', sectionId)) return true;
	return (labelIds ?? []).some(id => !roleOf(rows, 'label', id));
}

/** A new task lands where the guest may add: under an editable parent, or in a project or label shared to edit. */
function mayAdd(fields: TaskFields, rows: GuestRows): boolean {
	const { parentId, projectId, labelIds } = fields;
	if (parentId) return roleOf(rows, 'task', parentId) === 'edit';
	if (projectId && roleOf(rows, 'project', projectId) === 'edit') return true;
	return (labelIds ?? []).some(id => roleOf(rows, 'label', id) === 'edit');
}

/**
 * What the server holds for the row a guest writes to, read with the row's owner: a task's place, or a comment's
 * task and author. Undefined for a row the server does not hold.
 */
export type StoredRow = Partial<
	Pick<FieldsByKind['comment'], 'taskId' | 'authorId'> & Pick<FieldsByKind['task'], 'projectId' | 'parentId'>
>;

const NOT_EDITABLE = 'Not editable in this share';
const NOT_REMOVABLE = 'A guest cannot take a task out of its project or parent';

/** A guest clearing the project or parent of the owner's task would move it to the owner's Inbox, out of the share. */
function clearsPlace(fields: TaskFields, stored: StoredRow | undefined): boolean {
	return (fields.projectId === null && !!stored?.projectId) || (fields.parentId === null && !!stored?.parentId);
}

/**
 * Why a guest's write is refused, or null when it may run. The rows are the guest's `access` rows in the space the
 * write names, and they decide everything: a task the space holds needs an `edit` row, whatever the op, and keeps its
 * project and parent, a new task a place the guest may add to, and every project, section, label, and parent the
 * write names must be among the rows.
 * A comment needs an editable task, and only its author edits or deletes it. Projects, sections, labels, read
 * markers, and settings are never a guest's to write: managers are AI accounts, which act through the agent API with
 * the owner's own rights.
 */
export function guestRefusal(rows: GuestRows, write: RowWrite, actor: string, stored?: StoredRow): string | null {
	if (write.kind === 'task') {
		const role = roleOf(rows, 'task', write.id);
		if (write.op === 'delete') return role === 'edit' ? null : NOT_EDITABLE;
		const fields = (write.values ?? {}) as TaskFields;
		if (role !== undefined) {
			if (role !== 'edit') return NOT_EDITABLE;
			if (clearsPlace(fields, stored)) return NOT_REMOVABLE;
		} else if (write.op === 'patch' || stored || !mayAdd(fields, rows)) {
			return NOT_EDITABLE;
		}
		return pointsOutside(fields, rows) ? NOT_EDITABLE : null;
	}
	if (write.kind === 'comment') {
		const { taskId } = (write.values ?? {}) as CommentFields;
		if (!stored?.taskId) {
			if (write.op !== 'put' || !taskId) return NOT_EDITABLE;
			return roleOf(rows, 'task', taskId) === 'edit' ? null : NOT_EDITABLE;
		}
		if (stored.authorId !== actor) return authorOnly(write.op);
		if (roleOf(rows, 'task', stored.taskId) !== 'edit') return NOT_EDITABLE;
		return taskId === undefined || taskId === stored.taskId ? null : NOT_EDITABLE;
	}
	return NOT_EDITABLE;
}
