import type { ShareRow } from './db/schema.ts';
import { groupChildren } from './subtasks.ts';
import { applyPatch } from './sync/apply.ts';
import { DEFAULT_SETTINGS, type Op, type Snapshot, type Task } from './sync/protocol.ts';

/**
 * What a guest reaches in a space, from the owner's shares to them. Server only, never ported: the client only ever
 * sees the filtered snapshot. See `docs/decisions/sharing.md`.
 */

export type Grant = Pick<ShareRow, 'targetKind' | 'targetId' | 'role'>;

export type Scope = {
	/** Every task the grants reach, directly or as a descendant. */
	tasks: ReadonlySet<string>;
	/** The subset reached through an `edit` share. */
	editable: ReadonlySet<string>;
	/** The shared projects and labels, plus every one a visible task references. */
	projects: ReadonlySet<string>;
	labels: ReadonlySet<string>;
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
	}
	for (const id of tasks) {
		const task = byId.get(id)!;
		if (task.projectId) projects.add(task.projectId);
		for (const labelId of task.labelIds) labels.add(labelId);
	}
	return { tasks, editable, projects, labels };
}

/** The space as the guest sees it. Settings are the owner's own, so the guest gets defaults. */
export function filterSnapshot(snapshot: Snapshot, scope: Scope): Snapshot {
	return {
		tasks: snapshot.tasks.filter(task => scope.tasks.has(task.id)),
		projects: snapshot.projects.filter(project => scope.projects.has(project.id)),
		labels: snapshot.labels.filter(label => scope.labels.has(label.id)),
		settings: { ...DEFAULT_SETTINGS },
	};
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value);
}

/** cyrb53 over the stable JSON, so the hash is the same whichever process computes it. */
export function scopeHash(view: unknown): string {
	const text = stableJson(view);
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Which of a guest's ops may be written, checked in order against a working copy the admitted ops update. A guest
 * writes tasks only: an existing task must be editable before and after the op, a new one editable after it (under an
 * editable parent, or in an edit-shared project or label). A delete only needs the task editable before. Projects,
 * labels, and settings are never a guest's to write.
 */
export function admit(snapshot: Snapshot, grants: readonly Grant[], ops: readonly Op[]) {
	const admitted: Op[] = [];
	const refused: Op[] = [];
	let working = snapshot;
	let scope = scopeOf(working, grants);
	for (const op of ops) {
		if (op.kind !== 'task') {
			refused.push(op);
			continue;
		}
		const exists = working.tasks.some(task => task.id === op.id);
		if (exists && !scope.editable.has(op.id)) {
			refused.push(op);
			continue;
		}
		if (op.fields.deleted === true) {
			if (!exists) {
				refused.push(op);
				continue;
			}
			working = applyPatch(working, op);
			scope = scopeOf(working, grants);
			admitted.push(op);
			continue;
		}
		const next = applyPatch(working, op);
		const nextScope = scopeOf(next, grants);
		if (!nextScope.editable.has(op.id)) {
			refused.push(op);
			continue;
		}
		working = next;
		scope = nextScope;
		admitted.push(op);
	}
	return { admitted, refused };
}
