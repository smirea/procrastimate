import type { Label, Project, Section, Task } from './task.ts';
import { detachOrphans } from './subtasks.ts';

/**
 * How a reader treats a reference to a row that is gone, because the server never repairs data: concurrent edits
 * can leave a task pointing at a deleted parent, project, section, or label. Applied in memory when a client or the
 * server loads a space's rows, never written back, so every replica reads the same rows the same way:
 *
 * - A subtask whose parent is gone, or whose parents loop, reads as top level.
 * - A task in a deleted project reads as in Inbox, and a subtask's project is its root's.
 * - A section of a deleted project is dropped, and a task keeps its section only while it is top level and the
 *   section is a live one of its project.
 * - A deleted label leaves every `labelIds`.
 */

export type Entities = { tasks: Task[]; projects: Project[]; sections: Section[]; labels: Label[] };

/** The links between a space's rows, which is all `resolveDangling` and `scopeOf` read. */
export type Links = {
	tasks: Pick<Task, 'id' | 'parentId' | 'projectId' | 'sectionId' | 'labelIds'>[];
	projects: Pick<Project, 'id'>[];
	sections: Pick<Section, 'id' | 'projectId'>[];
	labels: Pick<Label, 'id'>[];
};

export function resolveDangling<T extends Links>(data: T): T {
	const projects = new Set(data.projects.map(project => project.id));
	const sections = data.sections.filter(section => projects.has(section.projectId));
	const sectionProject = new Map(sections.map(section => [section.id, section.projectId]));
	const labels = new Set(data.labels.map(label => label.id));

	const placed = detachOrphans(data.tasks).map(task => {
		const projectId = task.projectId !== null && projects.has(task.projectId) ? task.projectId : null;
		const labelIds = task.labelIds.filter(id => labels.has(id));
		if (projectId === task.projectId && labelIds.length === task.labelIds.length) return task;
		return { ...task, projectId, labelIds };
	});
	const rootProject = new Map<string, string | null>();
	const byId = new Map(placed.map(task => [task.id, task]));
	const projectOf = (task: Links['tasks'][number]): string | null => {
		let root = task;
		while (root.parentId !== null) root = byId.get(root.parentId)!;
		return root.projectId;
	};
	for (const task of placed) rootProject.set(task.id, projectOf(task));
	const tasks = placed.map(task => {
		const projectId = rootProject.get(task.id) ?? null;
		const sectionId =
			task.sectionId !== null && task.parentId === null && sectionProject.get(task.sectionId) === projectId
				? task.sectionId
				: null;
		return projectId === task.projectId && sectionId === task.sectionId ? task : { ...task, projectId, sectionId };
	});

	const same = tasks.every((task, index) => task === data.tasks[index]) && sections.length === data.sections.length;
	return same ? data : { ...data, tasks, sections };
}
