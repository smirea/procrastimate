import { z } from 'zod';
import { apiTokensRowSchema, peopleRowSchema, sharesRowSchema } from './db/generated/zod.ts';
import {
	commentSchema,
	labelSchema,
	projectSchema,
	sectionSchema,
	shareTargetSchema,
	taskSchema,
} from './sync/protocol.ts';
import { labelColorSchema } from './label-colors.ts';
import { clientStampSchema, roleSchema, shareTargetKindSchema } from './values.ts';

/**
 * Sharing's shapes. A space is one user's tasks, projects, sections, and labels, served by the `Account` object named by
 * that user's id. The owner shares the whole space, a project, a label, or a task, with a person or as a public
 * link. See `docs/decisions/sharing.md`.
 */

export const personSchema = peopleRowSchema.pick({ id: true, name: true, kind: true, ownerId: true }).meta({
	id: 'Person',
	description: 'A human, or an AI account with the human who owns it.',
});
export type Person = z.infer<typeof personSchema>;

export { shareTargetSchema, type ShareTarget } from './sync/protocol.ts';

export const shareAudienceSchema = z
	.discriminatedUnion('kind', [
		z.object({ kind: z.literal('link') }),
		z.object({ kind: z.literal('user'), userId: z.string(), role: roleSchema }),
	])
	.meta({
		id: 'ShareAudience',
		description: 'Who a new share is for: anyone with the link, read only, or one user with a role.',
		'x-inline': true,
	});
export type ShareAudience = z.infer<typeof shareAudienceSchema>;

/** How people search matches a name, on the server and on each client's instant local pass. */
export const namePrefixed = (name: string, q: string) => name.toLowerCase().startsWith(q.toLowerCase());

/** A `shares` row as the store hands it out. Revoking deletes it. */
export const shareSchema = sharesRowSchema.omit({ userId: true });
export type Share = z.infer<typeof shareSchema>;

export const shareViewSchema = z
	.object({
		id: sharesRowSchema.shape.id,
		target: shareTargetSchema,
		/** Null for a link share. */
		grantee: personSchema.nullable(),
		role: roleSchema,
		createdAt: sharesRowSchema.shape.createdAt,
		/** The public link, for a link share only. */
		url: z.string().nullable(),
	})
	.meta({ id: 'ShareView', description: 'A share as the owner sees it in the share sheet.' });
export type ShareView = z.infer<typeof shareViewSchema>;

export const sharedViewSchema = z
	.object({
		target: shareTargetSchema,
		owner: personSchema,
		tasks: z.array(taskSchema),
		projects: z.array(projectSchema),
		sections: z.array(sectionSchema),
		labels: z.array(labelSchema),
	})
	.meta({ id: 'SharedView', description: 'What a public link shows, read only, without signing in.' });
export type SharedView = z.infer<typeof sharedViewSchema>;

export const spaceSchema = z
	.object({ id: z.string(), owner: personSchema })
	.meta({ id: 'Space', description: 'A space shared with the signed-in user. `id` is its owner’s user id.' });
export type Space = z.infer<typeof spaceSchema>;

export const ACTIVITY_ACTIONS = [
	'created',
	'edited',
	'completed',
	'reopened',
	'deleted',
	'restored',
	'commented',
] as const;
export const activityActionSchema = z.enum(ACTIVITY_ACTIONS).meta({ id: 'ActivityAction' });
export type ActivityAction = z.infer<typeof activityActionSchema>;

export const activityEntrySchema = z
	.object({
		at: z.number().int(),
		actor: personSchema,
		action: activityActionSchema,
		/** What changed, in words that follow the actor's name: `changed due to Oct 20 and edited notes`. */
		summary: z.string(),
	})
	.meta({
		id: 'ActivityEntry',
		description: 'One change to a task, or one run of quick edits by the same actor, read from the space’s log.',
	});
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const apiTokenSchema = apiTokensRowSchema
	.omit({ userId: true, tokenHash: true })
	.meta({ id: 'ApiToken', description: 'An AI account’s token. The secret is shown once, when it is made.' });
export type ApiToken = z.infer<typeof apiTokenSchema>;

export const createdApiTokenSchema = z
	.object({
		id: apiTokensRowSchema.shape.id,
		token: z.string(),
		/** Instructions to paste into an AI assistant: the token and where its docs are. */
		prompt: z.string(),
	})
	.meta({
		id: 'CreatedApiToken',
		description: '`token` is `pm.<ownerId>.<secret>`, shown only this once, and `prompt` carries it.',
	});
export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>;

const taskShape = taskSchema.shape;

export const agentNewTaskSchema = z
	.object({
		/** Read by the quick add parser, as the app's quick add reads it. */
		text: z.string().optional(),
		title: taskShape.title.optional(),
		notes: taskShape.notes.optional(),
		projectId: taskShape.projectId.optional(),
		sectionId: taskShape.sectionId.optional(),
		parentId: taskShape.parentId.optional(),
		labelIds: taskShape.labelIds.optional(),
		priority: taskShape.priority.optional(),
	})
	.meta({ id: 'AgentNewTask', description: 'A task the agent command API adds. It needs `text` or `title`.' });
export type AgentNewTask = z.infer<typeof agentNewTaskSchema>;

export const taskClientsSchema = z
	.object({
		created: clientStampSchema.nullable(),
		edited: clientStampSchema
			.nullable()
			.meta({ description: 'The latest write, which is the creation until another.' }),
	})
	.meta({
		id: 'TaskClients',
		description:
			'Which app created a task and which wrote to it last. Null for writes from before the server recorded apps.',
	});
export type TaskClients = z.infer<typeof taskClientsSchema>;

export const agentTaskSchema = taskSchema
	.extend({ clients: taskClientsSchema })
	.meta({ id: 'AgentTask', description: 'A task with the apps that created and last changed it, for the agent API.' });
export type AgentTask = z.infer<typeof agentTaskSchema>;

export const spaceViewSchema = z
	.object({
		tasks: z.array(agentTaskSchema),
		projects: z.array(projectSchema),
		sections: z.array(sectionSchema),
		labels: z.array(labelSchema),
		/** Visible task ids the caller may not edit. */
		readOnly: z.array(z.string()),
	})
	.meta({ id: 'SpaceView', description: 'What the caller sees of a space, for the agent command API.' });
export type SpaceView = z.infer<typeof spaceViewSchema>;

export const taskCommentSchema = commentSchema
	.extend({ author: personSchema })
	.meta({ id: 'TaskComment', description: 'A comment on a task with its author, for the agent command API.' });
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const newCommentSchema = z
	.object({ taskId: commentSchema.shape.taskId, body: commentSchema.shape.body })
	.meta({ id: 'NewComment', description: 'A comment the agent command API adds. A blank body is refused.' });
export type NewComment = z.infer<typeof newCommentSchema>;

export const newProjectSchema = z
	.object({ name: projectSchema.shape.name })
	.meta({ id: 'NewProject', description: 'A project the agent command API adds. A blank name is refused.' });
export type NewProject = z.infer<typeof newProjectSchema>;

export const projectEditSchema = z
	.object({
		name: projectSchema.shape.name.optional(),
		index: z.number().int().nonnegative().optional().meta({ description: 'Its new place among the projects, from 0.' }),
	})
	.meta({
		id: 'ProjectEdit',
		description: 'Renames a project, moves it among the projects, or both. A blank name is refused.',
	});
export type ProjectEdit = z.infer<typeof projectEditSchema>;

export const newSectionSchema = z
	.object({ projectId: sectionSchema.shape.projectId, name: sectionSchema.shape.name })
	.meta({
		id: 'NewSection',
		description:
			'A section the agent command API adds last in its project. A name the project has already returns that section.',
	});
export type NewSection = z.infer<typeof newSectionSchema>;

export const sectionEditSchema = z
	.object({
		name: sectionSchema.shape.name.optional(),
		index: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.meta({ description: 'Its new place among the project’s sections, from 0.' }),
	})
	.meta({ id: 'SectionEdit', description: 'Renames a section, moves it among its project’s sections, or both.' });
export type SectionEdit = z.infer<typeof sectionEditSchema>;

export const newLabelSchema = z.object({ name: labelSchema.shape.name, color: labelColorSchema.optional() }).meta({
	id: 'NewLabel',
	description: 'A label the agent command API adds. A name already taken, ignoring case, returns that label.',
});
export type NewLabel = z.infer<typeof newLabelSchema>;

export const labelEditSchema = newLabelSchema
	.partial()
	.meta({ id: 'LabelEdit', description: 'Renames a label, recolors it, or both. Names stay unique ignoring case.' });
export type LabelEdit = z.infer<typeof labelEditSchema>;

export const newLinkSchema = z
	.object({
		target: z.object({ kind: shareTargetKindSchema.exclude(['space']), id: z.string() }),
	})
	.meta({
		id: 'NewLink',
		description:
			'A public read-only link to a task, a project, or a label. Asking again for the same target returns the same link.',
	});
export type NewLink = z.infer<typeof newLinkSchema>;
