import { detachOrphans } from './subtasks.ts';
import type { Section, Task } from './task.ts';
import type { Snapshot } from './model.ts';
import { byCreation } from './snapshot.ts';

/**
 * Repairs that concurrent edits can call for, run by the server after every push. Each one is what the
 * local commands already guarantee, so the result is a state a single device could have produced:
 *
 * - Projects with the same `sourceKey` or name (ignoring case) merge into the oldest, moving their tasks and sections.
 * - Sections of a deleted project are deleted. Sections with the same `sourceKey`, or the same name (ignoring case) in
 *   one project, merge into the oldest, and tasks take the survivor's id.
 * - Labels with the same name (ignoring case) merge into the oldest, and tasks take the survivor's id.
 * - Tasks with the same `sourceKey` merge into the oldest, and the dropped copies' subtasks move under it.
 * - Tasks drop labels that no longer exist, and tasks in a deleted project move to Inbox.
 * - A subtask whose parent is gone, or whose parents loop, becomes top level.
 * - A subtask takes its root task's project.
 * - An open task reopens every completed task above it.
 * - A task keeps its section only while it is top level and the section is a live one of its project.
 */
export function fixups(snapshot: Snapshot): Snapshot {
	const bySource = mergeDuplicates(snapshot.projects, p => p.sourceKey);
	const byName = mergeDuplicates(bySource.kept, p => p.name.toLowerCase());
	const projectOf = (id: string) =>
		byName.survivorOf.get(bySource.survivorOf.get(id) ?? id) ?? bySource.survivorOf.get(id) ?? id;
	const projects = new Set(byName.kept.map(p => p.id));

	const placed = snapshot.sections.flatMap(section => {
		const projectId = projectOf(section.projectId);
		if (!projects.has(projectId)) return [];
		return [section.projectId === projectId ? section : { ...section, projectId }];
	});
	const sectionBySource = mergeDuplicates(placed, s => s.sourceKey);
	const sectionByName = mergeDuplicates(sectionBySource.kept, s => `${s.projectId}\n${s.name.toLowerCase()}`);
	const sectionOf = (id: string) => {
		const bySource = sectionBySource.survivorOf.get(id) ?? id;
		return sectionByName.survivorOf.get(bySource) ?? bySource;
	};

	const labelMerge = mergeDuplicates(snapshot.labels, l => l.name.toLowerCase());
	const labels = new Set(labelMerge.kept.map(l => l.id));

	const taskMerge = mergeDuplicates(snapshot.tasks, t => t.sourceKey);

	let tasks = taskMerge.kept.map(task => {
		const parentId = task.parentId === null ? null : (taskMerge.survivorOf.get(task.parentId) ?? task.parentId);
		const movedTo = task.projectId === null ? null : projectOf(task.projectId);
		const projectId = movedTo !== null && projects.has(movedTo) ? movedTo : null;
		const labelIds = [
			...new Set(task.labelIds.map(id => labelMerge.survivorOf.get(id) ?? id).filter(id => labels.has(id))),
		];
		const sectionId = task.sectionId === null ? null : sectionOf(task.sectionId);
		return { ...task, parentId, projectId, sectionId, labelIds };
	});
	tasks = detachOrphans(tasks);
	tasks = takeRootProject(tasks);
	tasks = reopenAncestors(tasks);
	tasks = keepSections(tasks, sectionByName.kept);

	return { ...snapshot, tasks, projects: byName.kept, sections: sectionByName.kept, labels: labelMerge.kept };
}

function keepSections(tasks: readonly Task[], sections: readonly Section[]): Task[] {
	const projectOf = new Map(sections.map(s => [s.id, s.projectId]));
	return tasks.map(task => {
		if (task.sectionId === null) return task;
		const fits = task.parentId === null && projectOf.get(task.sectionId) === task.projectId;
		return fits ? task : { ...task, sectionId: null };
	});
}

function mergeDuplicates<T extends { id: string; createdAt: number }>(
	items: readonly T[],
	keyOf: (item: T) => string | undefined,
): { kept: T[]; survivorOf: Map<string, string> } {
	const survivors = new Map<string, T>();
	for (const item of items.toSorted(byCreation)) {
		const key = keyOf(item);
		if (key !== undefined && !survivors.has(key)) survivors.set(key, item);
	}
	const survivorOf = new Map<string, string>();
	const kept = items.filter(item => {
		const key = keyOf(item);
		const survivor = key === undefined ? item : survivors.get(key)!;
		if (survivor !== item) survivorOf.set(item.id, survivor.id);
		return survivor === item;
	});
	return { kept, survivorOf };
}

function rootOf(byId: ReadonlyMap<string, Task>, task: Task): Task {
	let root = task;
	for (let parent = byId.get(root.parentId ?? ''); parent; parent = byId.get(parent.parentId ?? '')) root = parent;
	return root;
}

function takeRootProject(tasks: readonly Task[]): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	return tasks.map(task => {
		const projectId = rootOf(byId, task).projectId;
		return task.projectId === projectId ? task : { ...task, projectId };
	});
}

function reopenAncestors(tasks: readonly Task[]): Task[] {
	const byId = new Map(tasks.map(t => [t.id, t]));
	const reopen = new Set<string>();
	for (const task of tasks) {
		if (task.completedAt !== null) continue;
		for (let parent = byId.get(task.parentId ?? ''); parent; parent = byId.get(parent.parentId ?? '')) {
			if (parent.completedAt !== null) reopen.add(parent.id);
		}
	}
	return tasks.map(task => (reopen.has(task.id) ? { ...task, completedAt: null } : task));
}
