import { z } from 'zod';
import { webhooksRowSchema } from './db/generated/zod.ts';

export const WEBHOOK_SIGNATURE_HEADER = 'x-procrastimate-signature';
export const WEBHOOK_SIGNATURE_PREFIX = 'sha256=';

export const webhookSchema = webhooksRowSchema.omit({ userId: true, secret: true, retryThrough: true }).meta({
	id: 'Webhook',
	description:
		'A URL the server POSTs to, within a minute, when a human adds a task or comments in the space. `cursor` is the last change it was told about. `failingSince` and `lastError` describe a run of failed POSTs, which retry every minute; a day of failures, or a `404` or `410`, sets `disabledAt` and stops it until it is registered again.',
});
export type Webhook = z.infer<typeof webhookSchema>;

export const newWebhookSchema = z
	.object({
		url: z.url().meta({ description: 'HTTPS, or HTTP to a loopback address.' }),
		projectIds: z.array(z.string()).optional().meta({
			description:
				'Only changes in these projects, at most 50. Omitted or empty watches the whole space, where moving a task between projects is not an addition.',
		}),
	})
	.meta({
		id: 'NewWebhook',
		description:
			'Registering a URL again updates its projects, keeps its secret, and turns a disabled hook back on from the current change, skipping what it missed.',
	});
export type NewWebhook = z.infer<typeof newWebhookSchema>;

export const createdWebhookSchema = webhookSchema
	.extend({
		secret: z.string().meta({
			description: `Signs each body: \`${WEBHOOK_SIGNATURE_HEADER}: ${WEBHOOK_SIGNATURE_PREFIX}<hex HMAC-SHA256 of the raw body>\`.`,
		}),
	})
	.meta({ id: 'CreatedWebhook' });
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const WEBHOOK_EVENT_TYPES = ['task.added', 'comment.added'] as const;

export const webhookEventSchema = z
	.object({
		type: z.enum(WEBHOOK_EVENT_TYPES).meta({
			description:
				'`task.added`: a human created the task, or moved it into a watched project. `comment.added`: a human commented on the task.',
		}),
		taskId: z.string(),
		commentId: z.string().nullable(),
		projectId: z.string().nullable(),
		actorId: z.string(),
		at: z.number().int(),
	})
	.meta({ id: 'WebhookEvent' });
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const webhookDeliverySchema = z
	.object({
		id: z.string().meta({ description: 'The same for a retried delivery, so a receiver can drop a repeat.' }),
		webhookId: z.string(),
		space: z.string(),
		summary: z.string().meta({ description: 'Counts only, such as `2 tasks added, 1 comment added`.' }),
		events: z.array(webhookEventSchema),
	})
	.meta({
		id: 'WebhookDelivery',
		description:
			'The body of a webhook POST. It carries ids only, never titles or comment text; read them through the API.',
	});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

/** Whether a live webhook watches the user's own project. A hook with no projects watches them all. */
export const watchedByWebhook = (hooks: readonly Webhook[], projectId: string) =>
	hooks.some(hook => hook.disabledAt === null && (hook.projectIds.length === 0 || hook.projectIds.includes(projectId)));
