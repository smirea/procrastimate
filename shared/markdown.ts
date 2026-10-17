import { z } from 'zod';
import { taskSchema } from './sync/protocol.ts';
import { groupChildren } from './subtasks.ts';
import type { Project, Task } from './task.ts';
import type { ProjectGroup } from './views.ts';

export const markdownSectionSchema = z
	.object({ heading: z.string().nullable(), tasks: z.array(taskSchema) })
	.meta({ id: 'MarkdownSection' });
export type MarkdownSection = z.infer<typeof markdownSectionSchema>;

/** What a copy holds: a view under its title, one section, or one task. */
export const markdownDocumentSchema = z
	.object({ title: z.string().nullable(), sections: z.array(markdownSectionSchema) })
	.meta({ id: 'MarkdownDocument' });
export type MarkdownDocument = z.infer<typeof markdownDocumentSchema>;

/** A project view's copy: its loose tasks, then each section under its name. */
export function projectDocument(project: Project, groups: readonly ProjectGroup[]): MarkdownDocument {
	return {
		title: project.name,
		sections: groups.map(group => ({ heading: group.section?.name ?? null, tasks: group.tasks })),
	};
}

const LIST_ITEM = /^([-*+]|\d+[.)])\s/;

/**
 * A copy as a plain nested list, for a person or an AI to get the gist: each task's title, then its notes and its
 * subtasks nested under it, with no checkboxes, dates, or tags. A notes line that is already a list item keeps its
 * marker. `tasks` is every task, so a subtask whose ancestor is also in the copy shows only there.
 */
export function toMarkdown(document: MarkdownDocument, tasks: readonly Task[]): string {
	const children = groupChildren(tasks);
	const byId = new Map(tasks.map(t => [t.id, t]));
	const copied = new Set(document.sections.flatMap(s => s.tasks.map(t => t.id)));

	const nested = (task: Task) => {
		for (let id = task.parentId; id !== null; id = byId.get(id)?.parentId ?? null) if (copied.has(id)) return true;
		return false;
	};

	const item = (task: Task, depth: number): string[] => {
		const indent = '  '.repeat(depth);
		const notes = task.notes
			.split(/\r?\n/)
			.filter(line => line.trim())
			.map(line => `${indent}  ${LIST_ITEM.test(line.trim()) ? line.trimEnd() : `- ${line.trim()}`}`);
		return [
			`${indent}- ${task.title.trim()}`,
			...notes,
			...(children.get(task.id) ?? []).flatMap(child => item(child, depth + 1)),
		];
	};

	const blocks = [
		...(document.title === null ? [] : [`# ${document.title}`]),
		...document.sections.flatMap(section => {
			const list = section.tasks.filter(t => !nested(t)).flatMap(t => item(t, 0));
			if (!list.length) return [];
			return [...(section.heading === null ? [] : [`## ${section.heading}`]), list.join('\n')];
		}),
	];
	return blocks.join('\n\n');
}
