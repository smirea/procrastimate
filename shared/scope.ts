import type { ShareRow } from './db/schema.ts';
import { groupChildren } from './subtasks.ts';
import { DEFAULT_SETTINGS, type FieldsByKind, type Snapshot, type Task } from './model.ts';
import { applyWrite, type RowWrite } from './rows.ts';

/**
 * What a guest reaches in a space, from the owner's shares to them. Server only, never ported: clients see only the
 * rows the server's `access` table lets PowerSync stream them. See `docs/decisions/sharing.md`.
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

export function scopeOf(snapshot: Snapshot, grants: readonly Grant[]): Scope {
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

/**
 * The space as the guest sees it. Comments follow their task. Settings and read markers are the owner's own, so the
 * guest gets defaults and none.
 */
export function filterSnapshot(snapshot: Snapshot, scope: Scope): Snapshot {
	return {
		tasks: snapshot.tasks.filter(task => scope.tasks.has(task.id)),
		projects: snapshot.projects.filter(project => scope.projects.has(project.id)),
		sections: snapshot.sections.filter(section => scope.sections.has(section.id)),
		labels: snapshot.labels.filter(label => scope.labels.has(label.id)),
		comments: snapshot.comments.filter(comment => scope.tasks.has(comment.taskId)),
		reads: [],
		settings: { ...DEFAULT_SETTINGS },
	};
}

/**
 * A guest's write may only point at what the guest can already see: a parent it may edit, and projects, sections, and
 * labels in its view, so it cannot graft its task onto the owner's private tree or pull hidden names into its snapshot. It may
 * not set `sourceKey` either, because fixups merge tasks by it and would tombstone the owner's matching task.
 */
function staysInScope(fields: Partial<FieldsByKind['task']>, scope: Scope): boolean {
	const { parentId, projectId, sectionId, labelIds, sourceKey } = fields;
	if (sourceKey !== undefined && sourceKey !== null) return false;
	if (parentId && !scope.editable.has(parentId)) return false;
	if (projectId && !scope.projects.has(projectId)) return false;
	if (sectionId && !scope.sections.has(sectionId)) return false;
	return (labelIds ?? []).every(id => scope.labels.has(id));
}

/**
 * A comment needs its task editable: a new one names such a task, and an existing one must be `actor`'s own and stay
 * on its task. So a view-only guest reads the comments but cannot write one. The author of a new comment is `actor`,
 * which the server stamps again when it writes it.
 */
function admitComment(working: Snapshot, scope: Scope, write: RowWrite, actor: string): RowWrite | null {
	const existing = working.comments.find(comment => comment.id === write.id);
	const { taskId } = (write.values ?? {}) as Partial<FieldsByKind['comment']>;
	if (existing) {
		const own = existing.authorId === actor && scope.editable.has(existing.taskId);
		return own && (taskId === undefined || taskId === existing.taskId) ? write : null;
	}
	if (write.op !== 'put' || taskId === undefined || !scope.editable.has(taskId)) return null;
	return { ...write, values: { ...write.values, authorId: actor } };
}

/**
 * Which of a guest's writes may be applied, checked in order against a working copy the admitted writes update. A
 * guest writes tasks and comments only: an existing task must be editable before and after the write, a new one
 * editable after it (under an editable parent, or in an edit-shared project or label). A delete only needs the task
 * editable before. Comments follow `admitComment`, whose admitted write carries the author. Projects, sections, and
 * labels are only a manager's to write, never with a `sourceKey`, and read markers and settings are never a guest's.
 */
export function admit(snapshot: Snapshot, grants: readonly Grant[], writes: readonly RowWrite[], actor: string) {
	const admitted: RowWrite[] = [];
	const refused: RowWrite[] = [];
	let working = snapshot;
	let scope = scopeOf(working, grants);
	const manager = managesSpace(grants);
	const accept = (write: RowWrite) => {
		working = applyWrite(working, write);
		scope = scopeOf(working, grants);
		admitted.push(write);
	};
	for (const write of writes) {
		if (write.kind === 'project' || write.kind === 'section' || write.kind === 'label') {
			const { sourceKey } = (write.values ?? {}) as { sourceKey?: string | null };
			if (manager && (sourceKey === undefined || sourceKey === null)) accept(write);
			else refused.push(write);
			continue;
		}
		if (write.kind === 'comment') {
			const allowed = admitComment(working, scope, write, actor);
			if (allowed) accept(allowed);
			else refused.push(write);
			continue;
		}
		if (write.kind !== 'task') {
			refused.push(write);
			continue;
		}
		const exists = working.tasks.some(task => task.id === write.id);
		if (exists && !scope.editable.has(write.id)) {
			refused.push(write);
			continue;
		}
		if (write.op === 'delete') {
			if (exists) accept(write);
			else refused.push(write);
			continue;
		}
		if (!staysInScope((write.values ?? {}) as Partial<FieldsByKind['task']>, scope)) {
			refused.push(write);
			continue;
		}
		const next = applyWrite(working, write);
		const nextScope = scopeOf(next, grants);
		if (!nextScope.editable.has(write.id)) {
			refused.push(write);
			continue;
		}
		working = next;
		scope = nextScope;
		admitted.push(write);
	}
	return { admitted, refused };
}
