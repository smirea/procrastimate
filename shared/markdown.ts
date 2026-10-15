import { z } from 'zod';
import { formatDue, formatRecurrence } from './format.ts';
import { labelSchema, projectSchema, taskSchema } from './sync/protocol.ts';
import { groupChildren } from './subtasks.ts';
import type { Task } from './task.ts';
import { scheduledDue } from './triggers.ts';
import { dateKeySchema } from './values.ts';

export const markdownSectionSchema = z
	.object({ heading: z.string().nullable(), tasks: z.array(taskSchema) })
	.meta({ id: 'MarkdownSection' });
export type MarkdownSection = z.infer<typeof markdownSectionSchema>;

/** What a copy holds: a view under its title, one section, or one task. `projectId` names the project a copy comes from, whose rows then skip the project tag. */
export const markdownDocumentSchema = z
	.object({ title: z.string().nullable(), projectId: z.string().nullable(), sections: z.array(markdownSectionSchema) })
	.meta({ id: 'MarkdownDocument' });
export type MarkdownDocument = z.infer<typeof markdownDocumentSchema>;

export const markdownContextSchema = z
	.object({
		tasks: z.array(taskSchema),
		projects: z.array(projectSchema),
		labels: z.array(labelSchema),
		today: dateKeySchema,
	})
	.meta({ id: 'MarkdownContext' });
export type MarkdownContext = z.infer<typeof markdownContextSchema>;

/**
 * A copy as a Markdown checklist. Each task carries its subtasks nested under it, done ones checked, so a subtask
 * whose ancestor is also in the copy shows only there.
 */
export function toMarkdown(document: MarkdownDocument, context: MarkdownContext): string {
	const children = groupChildren(context.tasks);
	const projects = new Map(context.projects.map(p => [p.id, p.name]));
	const labels = new Map(context.labels.map(l => [l.id, l.name]));
	const byId = new Map(context.tasks.map(t => [t.id, t]));
	const copied = new Set(document.sections.flatMap(s => s.tasks.map(t => t.id)));

	const nested = (task: Task) => {
		for (let id = task.parentId; id !== null; id = byId.get(id)?.parentId ?? null) if (copied.has(id)) return true;
		return false;
	};

	const line = (task: Task) => {
		const due = scheduledDue(task, context.today);
		const project =
			task.parentId === null && task.projectId !== document.projectId ? projects.get(task.projectId ?? '') : undefined;
		return [
			task.title,
			due && formatDue(due, context.today),
			task.recurrence && formatRecurrence(task.recurrence, due),
			task.priority < 4 && `p${task.priority}`,
			project && `#${project}`,
			...task.labelIds.flatMap(id => (labels.has(id) ? [`@${labels.get(id)}`] : [])),
		]
			.filter(Boolean)
			.join(' · ');
	};

	const item = (task: Task, depth: number): string[] => {
		const indent = '  '.repeat(depth);
		const notes = task.notes.trim()
			? task.notes
					.trim()
					.split('\n')
					.map(note => `${indent}  ${note}`.trimEnd())
			: [];
		return [
			`${indent}- [${task.completedAt === null ? ' ' : 'x'}] ${line(task)}`,
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
