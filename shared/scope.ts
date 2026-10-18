import type { Entities } from './dangling.ts';
import type { AccessRow, ShareRow } from './db/schema.ts';
import { groupChildren } from './subtasks.ts';
import type { FieldsByKind, Task } from './model.ts';
import type { RowWrite } from './rows.ts';

/**
 * What a guest reaches in a space: `scopeOf` computes it from the owner's shares and rows, and the server stores the
 * result as `access` rows, which `guestRefusal` then checks a guest's write against. Server only, never ported:
 * clients see only the rows the `access` table lets PowerSync stream them. See `docs/decisions/sharing.md`.
 */

export type Grant = Pick<ShareRow, 'targetKind' | 'targetId' | 'role'>;

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

export function scopeOf(snapshot: Entities, grants: readonly Grant[]): Scope {
	const byId = new Map(snapshot.tasks.map(task => [task.id, task]));
	const children = groupChildren(snapshot.tasks);
	const rootProject = (task: Task): string | null => {
		let current = task;
		const seen = new Set<string>();
		while (current.parentId && !seen.has(current.id)) {
			seen.add(current.id);
			const parent = byId.get(current.parentId);
			if (!parent) break;
			current = parent;
		}
		return current.projectId;
	};
	const reaches = ({ targetKind, targetId }: Grant, task: Task) => {
		switch (targetKind) {
			case 'space':
				return true;
			case 'project':
				return rootProject(task) === targetId;
			case 'label':
				return task.labelIds.includes(targetId);
			case 'task':
				return task.id === targetId;
		}
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
		if (grant.targetKind === 'project') projects.add(grant.targetId);
		if (grant.targetKind === 'label') labels.add(grant.targetId);
		if (grant.targetKind === 'space' && grant.role === 'edit') {
			for (const { id } of snapshot.projects) projects.add(id);
			for (const { id } of snapshot.labels) labels.add(id);
		}
	}
	for (const id of tasks) {
		const task = byId.get(id)!;
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

type TaskFields = Partial<FieldsByKind['task']>;
type CommentFields = Partial<FieldsByKind['comment']>;

const roleOf = (rows: GuestRows, kind: AccessRow['kind'], id: string) =>
	rows.find(row => row.kind === kind && row.entityId === id)?.role;

/**
 * A guest's write may only point at what the guest can already see: a parent it may edit, and projects, sections, and
 * labels among its rows, so it cannot graft its task onto the owner's private tree or pull hidden names into its
 * view. It may not set `sourceKey` either, which only imports write.
 */
function pointsOutside(fields: TaskFields, rows: GuestRows): boolean {
	const { parentId, projectId, sectionId, labelIds, sourceKey } = fields;
	if (sourceKey !== undefined && sourceKey !== null) return true;
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

/** What the server knows of a stored comment a guest writes to, read with the row's owner. */
export type StoredComment = Pick<FieldsByKind['comment'], 'taskId' | 'authorId'>;

/**
 * Why a guest's write is refused, or null when it may run. The rows are the guest's `access` rows in the space the
 * write names, and they decide everything: an existing task needs an `edit` row, a new task a place the guest may add
 * to, and every project, section, label, and parent the write names must be among the rows. A comment needs an
 * editable task, and only its author edits or deletes it; `stored` is the comment as the server holds it, or
 * undefined for one it does not. Projects, sections, labels, read markers, and settings are never a guest's to
 * write: managers are AI accounts, which act through the agent API with the owner's own rights.
 */
export function guestRefusal(rows: GuestRows, write: RowWrite, actor: string, stored?: StoredComment): string | null {
	if (write.kind === 'task') {
		const role = roleOf(rows, 'task', write.id);
		if (write.op === 'delete') return role === 'edit' ? null : 'Not editable in this share';
		const fields = (write.values ?? {}) as TaskFields;
		if (role !== undefined && role !== 'edit') return 'Not editable in this share';
		if (role === undefined && !mayAdd(fields, rows)) return 'Not editable in this share';
		return pointsOutside(fields, rows) ? 'Not editable in this share' : null;
	}
	if (write.kind === 'comment') {
		const { taskId } = (write.values ?? {}) as CommentFields;
		if (!stored) {
			if (write.op !== 'put' || !taskId) return 'Not editable in this share';
			return roleOf(rows, 'task', taskId) === 'edit' ? null : 'Not editable in this share';
		}
		if (stored.authorId !== actor) {
			return write.op === 'delete' ? 'Only the author can delete a comment' : 'Only the author can edit a comment';
		}
		if (roleOf(rows, 'task', stored.taskId) !== 'edit') return 'Not editable in this share';
		return taskId === undefined || taskId === stored.taskId ? null : 'Not editable in this share';
	}
	return 'Not editable in this share';
}
