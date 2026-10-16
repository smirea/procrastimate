import { z } from 'zod';
import { apiTokensRowSchema, peopleRowSchema, sharesRowSchema } from './db/generated/zod.ts';
import { labelSchema, projectSchema, sectionSchema, shareTargetSchema, taskSchema } from './sync/protocol.ts';
import { roleSchema } from './values.ts';

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

export const ACTIVITY_ACTIONS = ['created', 'edited', 'completed', 'reopened', 'deleted', 'restored'] as const;
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

export const spaceViewSchema = z
	.object({
		tasks: z.array(taskSchema),
		projects: z.array(projectSchema),
		sections: z.array(sectionSchema),
		labels: z.array(labelSchema),
		/** Visible task ids the caller may not edit. */
		readOnly: z.array(z.string()),
	})
	.meta({ id: 'SpaceView', description: 'What the caller sees of a space, for the agent command API.' });
export type SpaceView = z.infer<typeof spaceViewSchema>;
